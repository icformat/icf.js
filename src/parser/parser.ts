/**
 * The resilient single-pass ICF parser.
 *
 * Mirrors icfj's `IcfParser`: it **never throws on content errors**. It
 * accumulates {@link ValidationMessage}s and returns a best-effort
 * {@link IcfDocument} inside a {@link ParseResult}. The {@link parse} facade
 * decides whether to surface ERROR-severity diagnostics as an exception.
 *
 * State machine: HEADER → METADATA → SCHEMA → MASTERS → DATA.
 *  - Schema and data each use an indentation stack (pop frames whose
 *    `indent >= current`).
 *  - Masters use a flat "current type" pointer (masters are not nested).
 */

import { IcfDocument, IcfRecord } from '../document.js';
import { IcfMetadata } from '../model/metadata.js';
import { IcfMasters } from '../model/masters.js';
import { IcfSchema, IcfSchemas, SchemaNode } from '../model/schema.js';
import { IcfArray, IcfNode, IcfObject, IcfString, NULL } from '../model/node.js';
import { Severity, ValidationMessage } from '../validation.js';
import { ParseResult } from './result.js';
import { splitAndUnescape, unescape } from './escaper.js';
import { findPrimaryObject, REFERENCE_PATTERN } from '../resolver.js';
import { hasUnescapedJoin, splitTags } from '../tags.js';

enum Section {
  HEADER,
  METADATA,
  SCHEMA,
  MASTERS,
  DATA,
}

interface SchemaFrame {
  node: SchemaNode;
  indent: number;
}

type DataFrame =
  | { kind: 'container'; node: IcfObject; schemaNode: SchemaNode; indent: number }
  | { kind: 'collection'; node: IcfArray; schemaNode: SchemaNode; indent: number }
  | {
      kind: 'leaf';
      parentObject: IcfObject;
      name: string;
      schemaNode: SchemaNode;
      indent: number;
      filled: boolean;
    };

/** Strips a single leading UTF-8 BOM (spec §24). */
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

// Cheap reference prefilter (shared REFERENCE_PATTERN) — the type must also
// be a declared master type (or a record-local primary object) before the
// reference is checked for resolution.
const REFERENCE_CANDIDATE = REFERENCE_PATTERN;

/** Reserved directive names (spec v1.1 §9) — discouraged as object names. */
const RESERVED_DIRECTIVE_NAMES = new Set([
  'kind', 'version', 'encoding', 'delimiter', 'escape',
  'namespace', 'vendor', 'generator',
  'created', 'modified', 'revision',
  'hashmethod', 'checksum', 'index',
  'metadata', 'schema', 'masters', 'data', 'record',
]);

/** Standard schema-annotation names (spec v1.1 §26). */
const STANDARD_SCHEMA_ANNOTATION_NAMES = new Set(['indexes', 'defaults', 'constraints', 'expressions']);

/** Standard row-annotation names (spec v1.1 §46). */
const STANDARD_ROW_ANNOTATION_NAMES = new Set(['overrides']);

/** A row whose text ended with a trailing delimiter, awaiting continuation. */
interface PendingRow {
  text: string;
  line: number;
  /** Indent of the line that started the row — continuation must be deeper (§59). */
  indent: number;
  commit: (text: string, line: number) => void;
}

/** An open `!annotation:` in the schema section, awaiting entry rows. */
interface SchemaAnnotationContext {
  owner: SchemaNode;
  name: string;
  indent: number;
}

/** An open `!annotation:` after a data/masters row, awaiting entry rows. */
interface RowAnnotationContext {
  target: IcfObject;
  name: string;
  indent: number;
}

export class IcfParser {
  /** Highest ICF major version this parser implements. */
  static readonly SUPPORTED_MAJOR_VERSION = 1;
  /** Highest ICF minor version this parser implements. */
  static readonly SUPPORTED_MINOR_VERSION = 1;

  private readonly messages: ValidationMessage[] = [];
  private metadata!: IcfMetadata;
  private schemas!: IcfSchemas;
  private masters!: IcfMasters;
  private records!: IcfRecord[];
  /** Line number of each record's `@record` directive (parallel to records). */
  private recordLines: number[] = [];

  // `Type:Id` values seen in any row (masters + data), resolved against the
  // fully-built masters in finalValidation (masters always parse before data).
  // `record` is the containing record for @data rows (primary-first, §45).
  private readonly refChecks: { line: number; value: string; record: IcfRecord | null }[] = [];

  // every row bound to a schema node, for `!constraints` validation (v1.1 §29)
  private readonly rowsByNode = new Map<SchemaNode, { obj: IcfObject; line: number }[]>();

  private section = Section.HEADER;

  // schema parsing state
  private currentSchema: IcfSchema | null = null;
  private schemaStack: SchemaFrame[] = [];

  // masters parsing state
  private currentMasterType: string | null = null;

  // data parsing state
  private dataStack: DataFrame[] = [];
  private hasRecord = false;

  // v1.1 state: multiline row continuation + open annotations + last row
  private pendingRow: PendingRow | null = null;
  private schemaAnnotation: SchemaAnnotationContext | null = null;
  private rowAnnotation: RowAnnotationContext | null = null;
  private lastRowObject: IcfObject | null = null;

  // text-block state (checked at the very top of the loop)
  private inTextBlock = false;
  private textBlockTag = '';
  private textBlockIndent = 0;
  private textBlockBuffer: string[] = [];
  private textBlockOwner: Extract<DataFrame, { kind: 'leaf' }> | null = null;

  /** Resilient parse — always returns a best-effort document plus diagnostics. */
  parse(text: string): ParseResult {
    this.reset();
    const lines = stripBom(text).split(/\r\n|\r|\n/);

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i]!;
      const lineNo = i + 1;

      // 1) text-block mode takes precedence over everything
      if (this.inTextBlock) {
        this.handleTextBlockLine(raw, lineNo);
        continue;
      }

      const trimmed = raw.trim();
      if (trimmed === '') continue; // empty lines ignored outside text blocks (pending rows persist)

      const { indent, hadTab } = this.indentOf(raw);

      // 1b) multiline row continuation (spec v1.1 §59): a row ending with a
      // trailing unescaped delimiter consumes subsequent *bare-value* lines
      // indented deeper than the row's start ("aligned beneath the first
      // value"). Structural lines (directives, row markers, annotations,
      // field lists, text blocks, declarations ending in ':') or a
      // same/shallower-indented line terminate the pending row instead —
      // otherwise a legitimate row whose last cell is empty (e.g. ICX rows
      // with empty positional fields) would swallow the next line.
      if (this.pendingRow !== null) {
        if (indent > this.pendingRow.indent && !this.isRowTerminator(trimmed)) {
          this.pendingRow.text = `${this.pendingRow.text.trimEnd()} ${trimmed}`;
          if (!this.endsWithOpenDelimiter(this.pendingRow.text)) this.flushPendingRow();
          continue;
        }
        this.flushPendingRow(); // fall through to the structural line
      }
      if (hadTab) {
        this.warn('TAB_INDENT', 'Tab used for indentation; 2 spaces recommended', lineNo);
      }

      // 2) directive lines
      if (trimmed.startsWith('@')) {
        this.handleDirective(trimmed, lineNo);
        continue;
      }

      // 3) content lines, dispatched by section
      switch (this.section) {
        case Section.SCHEMA:
          this.handleSchemaLine(trimmed, indent, lineNo);
          break;
        case Section.MASTERS:
          this.handleMastersLine(trimmed, indent, lineNo);
          break;
        case Section.DATA:
          this.handleDataLine(raw, trimmed, indent, lineNo);
          break;
        case Section.METADATA:
          this.handleMetadataLine(trimmed, lineNo);
          break;
        default:
          this.warn('STRAY_LINE', `Unexpected line before any section: "${trimmed}"`, lineNo);
      }
    }

    this.flushPendingRow(); // a row may still be pending at EOF

    if (this.inTextBlock) {
      // close gracefully at EOF
      this.warn('UNCLOSED_TEXT_BLOCK', `Text block <<${this.textBlockTag} never closed`, lineNo(lines));
      this.closeTextBlock();
    }

    this.finalValidation();

    const document = new IcfDocument(this.metadata, this.schemas, this.masters, this.records);
    return new ParseResult(document, [...this.messages]);
  }

  // ---- setup ------------------------------------------------------------

  private reset(): void {
    this.messages.length = 0;
    this.metadata = new IcfMetadata();
    this.schemas = new IcfSchemas();
    this.masters = new IcfMasters();
    this.records = [];
    this.section = Section.HEADER;
    this.currentSchema = null;
    this.schemaStack = [];
    this.currentMasterType = null;
    this.dataStack = [];
    this.hasRecord = false;
    this.inTextBlock = false;
    this.textBlockOwner = null;
    this.textBlockBuffer = [];
    this.refChecks.length = 0;
    this.recordLines = [];
    this.rowsByNode.clear();
    this.pendingRow = null;
    this.schemaAnnotation = null;
    this.rowAnnotation = null;
    this.lastRowObject = null;
  }

  // ---- multiline rows (spec v1.1 §59) ------------------------------------

  /** True when `s` (ignoring trailing whitespace) ends with an unescaped delimiter. */
  private endsWithOpenDelimiter(s: string): boolean {
    const t = s.trimEnd();
    if (t === '' || t[t.length - 1] !== this.delimiter) return false;
    let escapes = 0;
    for (let i = t.length - 2; i >= 0 && t[i] === this.escape; i--) escapes++;
    return escapes % 2 === 0;
  }

  /**
   * True when `trimmed` is a structural line that ends a pending row rather
   * than continuing it: a directive, row marker, annotation, field list,
   * text-block opener, or a declaration line ending in `:`. Bare value
   * segments (e.g. `Anand,` or `Vendor:VEN001`) are continuation.
   */
  private isRowTerminator(trimmed: string): boolean {
    const first = trimmed[0]!;
    if (first === '@' || first === '=' || first === '-' || first === '!' || first === '[') return true;
    if (trimmed.startsWith('<<')) return true;
    if (!trimmed.endsWith(':')) return false;
    // only an *unescaped* trailing colon is a declaration opener
    let escapes = 0;
    for (let i = trimmed.length - 2; i >= 0 && trimmed[i] === this.escape; i--) escapes++;
    return escapes % 2 === 0;
  }

  /** Commits `text` now, or parks it as a pending row awaiting continuation. */
  private submitRow(
    text: string,
    line: number,
    indent: number,
    commit: (text: string, line: number) => void,
  ): void {
    if (this.endsWithOpenDelimiter(text)) {
      this.pendingRow = { text, line, indent, commit };
    } else {
      commit(text, line);
    }
  }

  private flushPendingRow(): void {
    if (this.pendingRow === null) return;
    const pending = this.pendingRow;
    this.pendingRow = null;
    pending.commit(pending.text, pending.line);
  }

  private get delimiter(): string {
    return this.metadata.getDelimiterChar();
  }

  private get escape(): string {
    return this.metadata.getEscapeChar();
  }

  // ---- diagnostics ------------------------------------------------------

  private error(code: string, message: string, line = 0): void {
    this.messages.push(new ValidationMessage(Severity.ERROR, code, message, line));
  }

  private warn(code: string, message: string, line = 0): void {
    this.messages.push(new ValidationMessage(Severity.WARNING, code, message, line));
  }

  // ---- indentation ------------------------------------------------------

  private indentOf(line: string): { indent: number; hadTab: boolean } {
    let indent = 0;
    let hadTab = false;
    for (const ch of line) {
      if (ch === ' ') indent++;
      else if (ch === '\t') {
        indent++;
        hadTab = true;
      } else break;
    }
    return { indent, hadTab };
  }

  private firstUnescapedColon(s: string): number {
    for (let i = 0; i < s.length; i++) {
      if (s[i] === this.escape) {
        i++;
        continue;
      }
      if (s[i] === ':') return i;
    }
    return -1;
  }

  // ---- directives -------------------------------------------------------

  private handleDirective(trimmed: string, lineNo: number): void {
    // a directive closes any open annotation / row-binding context
    this.schemaAnnotation = null;
    this.rowAnnotation = null;
    this.lastRowObject = null;

    const rest = trimmed.slice(1);
    const spaceIdx = rest.search(/\s/);
    const name = (spaceIdx < 0 ? rest : rest.slice(0, spaceIdx)).trim();
    const value = spaceIdx < 0 ? '' : rest.slice(spaceIdx + 1).trim();
    const lower = name.toLowerCase();

    switch (lower) {
      case 'schema':
        this.enterSchema(value, lineNo);
        return;
      case 'masters':
        this.enterMasters(lineNo);
        return;
      case 'data':
        this.section = Section.DATA;
        return;
      case 'record':
        this.startRecord(value, lineNo);
        return;
      case 'metadata':
        this.section = Section.METADATA;
        return;
      default:
        this.metadata.put(name, value);
        if (lower === 'version') this.checkVersion(value, lineNo);
        return;
    }
  }

  private checkVersion(value: string, lineNo: number): void {
    // An ICX document's @version is the ICX spec version, not the ICF
    // language version (ICX v1.2 §14) — the ICF gate does not apply.
    // (@kind is the first line of an ICX file, so it is known by now.)
    if (this.metadata.getKind() === 'icx') return;
    const m = /^(\d+)(?:\.(\d+))?/.exec(value.trim());
    if (!m) return;
    const major = Number.parseInt(m[1]!, 10);
    const minor = m[2] ? Number.parseInt(m[2], 10) : 0;
    if (major > IcfParser.SUPPORTED_MAJOR_VERSION) {
      this.error(
        'UNSUPPORTED_MAJOR_VERSION',
        `ICF ${value} has a higher major version than supported (${IcfParser.SUPPORTED_MAJOR_VERSION}.${IcfParser.SUPPORTED_MINOR_VERSION})`,
        lineNo,
      );
    } else if (major === IcfParser.SUPPORTED_MAJOR_VERSION && minor > IcfParser.SUPPORTED_MINOR_VERSION) {
      this.warn(
        'HIGHER_MINOR_VERSION',
        `ICF ${value} has a higher minor version than supported; unknown features ignored`,
        lineNo,
      );
    }
  }

  private enterSchema(value: string, lineNo: number): void {
    let id = IcfSchemas.DEFAULT_ID;
    const m = /(?:^|\s)id=(\S+)/.exec(value);
    if (m) id = m[1]!;
    if (this.schemas.has(id)) {
      this.error('DUPLICATE_SCHEMA_ID', `Duplicate schema id "${id}"`, lineNo);
    }
    this.currentSchema = this.schemas.getOrCreate(id);
    this.schemaStack = [{ node: this.currentSchema.getRoot(), indent: -1 }];
    this.section = Section.SCHEMA;
  }

  private enterMasters(lineNo: number): void {
    if (this.schemas.isEmpty()) {
      this.warn('MASTERS_BEFORE_SCHEMA', 'A @masters section appears before any @schema', lineNo);
    }
    this.currentMasterType = null;
    this.section = Section.MASTERS;
  }

  // ---- metadata section -------------------------------------------------

  private handleMetadataLine(trimmed: string, lineNo: number): void {
    const idx = trimmed.indexOf(':');
    if (idx < 0) {
      this.warn('UNEXPECTED_METADATA_LINE', `Metadata line is not "key: value": "${trimmed}"`, lineNo);
      return;
    }
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim();
    if (key === '') {
      this.warn('EMPTY_METADATA_KEY', 'Metadata key is empty', lineNo);
      return;
    }
    this.metadata.putUserMetadata(key, val);
  }

  // ---- schema section ---------------------------------------------------

  private popSchema(indent: number): void {
    while (this.schemaStack.length > 1 && this.schemaStack[this.schemaStack.length - 1]!.indent >= indent) {
      this.schemaStack.pop();
    }
  }

  private handleSchemaLine(trimmed: string, indent: number, lineNo: number): void {
    if (!this.currentSchema) return;

    // v1.1 §25: `!annotation:` lines and their `=` entry rows
    if (trimmed.startsWith('!')) {
      this.handleSchemaAnnotation(trimmed, indent, lineNo);
      return;
    }
    if (trimmed.startsWith('=') || trimmed.startsWith('-')) {
      const ann = this.schemaAnnotation;
      if (ann && indent > ann.indent) {
        this.submitRow(trimmed.slice(1).trim(), lineNo, indent, (text, line) => {
          const entries = splitAndUnescape(text, this.delimiter, this.escape);
          this.checkAnnotationEntries(ann.name, entries, line);
          ann.owner.addAnnotationEntries(ann.name, entries);
        });
        return;
      }
      this.schemaAnnotation = null;
      this.warn('UNEXPECTED_SCHEMA_LINE', `Not a schema declaration: "${trimmed}"`, lineNo);
      return;
    }
    this.schemaAnnotation = null;

    if (trimmed.startsWith('[')) {
      const close = trimmed.lastIndexOf(']');
      if (close < 0) {
        this.error('UNCLOSED_FIELD_LIST', `Unclosed field list: "${trimmed}"`, lineNo);
        return;
      }
      const inner = trimmed.slice(1, close);
      const fields = inner.trim() === '' ? [] : splitAndUnescape(inner, this.delimiter, this.escape);
      this.popSchema(indent);
      const owner = this.schemaStack[this.schemaStack.length - 1]!.node;
      if (owner === this.currentSchema.getRoot()) {
        this.error('FIELD_LIST_WITHOUT_OWNER', 'Field list has no owning node', lineNo);
        return;
      }
      if (owner.getFields().length > 0) {
        this.warn('DUPLICATE_FIELD_LIST', `Node "${owner.name}" already has a field list`, lineNo);
      }
      owner.setFields(fields);
      return;
    }

    const colon = this.firstUnescapedColon(trimmed);
    if (colon < 0) {
      this.warn('UNEXPECTED_SCHEMA_LINE', `Not a schema declaration: "${trimmed}"`, lineNo);
      return;
    }
    let namePart = trimmed.slice(0, colon).trim();
    let collection = false;
    if (namePart.endsWith('[]')) {
      collection = true;
      namePart = namePart.slice(0, -2);
    }
    const name = unescape(namePart, this.escape);
    if (name === '') {
      this.error('EMPTY_NODE_NAME', 'Schema node has an empty name', lineNo);
      return;
    }
    // ICX 1.1 §4 aligns ICX with this rule, so it applies to every document
    // kind — legacy ICX 1.0 files using `index[]` get this (non-fatal) warning.
    if (RESERVED_DIRECTIVE_NAMES.has(name)) {
      this.warn(
        'RESERVED_OBJECT_NAME',
        `Object name "${name}" is a reserved directive name; avoid it in ICF 1.1+ documents`,
        lineNo,
      );
    }
    this.popSchema(indent);
    const parent = this.schemaStack[this.schemaStack.length - 1]!.node;
    if (parent.hasChild(name)) {
      this.warn('DUPLICATE_NODE', `Duplicate schema node "${name}"`, lineNo);
    }
    const node = new SchemaNode(name, collection);
    parent.addChild(node);
    this.schemaStack.push({ node, indent });
  }

  // ---- annotations (spec v1.1 §25–§31, §46–§47) ---------------------------

  /** Splits `!name: [inline entries]`; returns `null` (and warns) when malformed. */
  private parseAnnotationHead(
    trimmed: string,
    lineNo: number,
    sectionCode: string,
  ): { name: string; after: string } | null {
    const colon = this.firstUnescapedColon(trimmed);
    if (colon < 0) {
      this.warn(sectionCode, `Annotation line has no colon: "${trimmed}"`, lineNo);
      return null;
    }
    const name = unescape(trimmed.slice(1, colon).trim(), this.escape);
    if (name === '') {
      this.warn(sectionCode, `Annotation has an empty name: "${trimmed}"`, lineNo);
      return null;
    }
    return { name, after: trimmed.slice(colon + 1).trim() };
  }

  private handleSchemaAnnotation(trimmed: string, indent: number, lineNo: number): void {
    const head = this.parseAnnotationHead(trimmed, lineNo, 'UNEXPECTED_SCHEMA_LINE');
    if (!head || !this.currentSchema) return;
    const { name, after } = head;

    this.popSchema(indent);
    let owner = this.schemaStack[this.schemaStack.length - 1]!.node;
    if (owner === this.currentSchema.getRoot()) {
      this.error('ANNOTATION_WITHOUT_OWNER', `Annotation !${name} has no owning object`, lineNo);
      // route the entry rows to a discarded sink so they don't cascade
      owner = new SchemaNode('(orphan)');
      this.schemaAnnotation = { owner, name, indent };
      return;
    }
    if (!STANDARD_SCHEMA_ANNOTATION_NAMES.has(name) && !name.includes('.')) {
      this.warn('UNKNOWN_ANNOTATION', `Unknown annotation !${name} (not standard, not namespaced)`, lineNo);
    }
    if (owner.getChildren().size > 0) {
      this.warn(
        'ANNOTATION_AFTER_CHILDREN',
        `Annotation !${name} appears after child objects of "${owner.name}" (field definition, annotations, then children — spec §22)`,
        lineNo,
      );
    }
    const context: SchemaAnnotationContext = { owner, name, indent };
    this.schemaAnnotation = context;
    if (after !== '') {
      // compact form: !name: entry, entry
      this.submitRow(after, lineNo, indent, (text, line) => {
        const entries = splitAndUnescape(text, this.delimiter, this.escape);
        this.checkAnnotationEntries(context.name, entries, line);
        context.owner.addAnnotationEntries(context.name, entries);
      });
    }
  }

  private handleRowAnnotation(trimmed: string, indent: number, lineNo: number): void {
    const sectionCode = this.section === Section.MASTERS ? 'UNEXPECTED_MASTERS_LINE' : 'UNEXPECTED_DATA_LINE';
    const head = this.parseAnnotationHead(trimmed, lineNo, sectionCode);
    if (!head) return;
    const { name, after } = head;

    if (this.lastRowObject === null) {
      this.error('ROW_ANNOTATION_WITHOUT_ROW', `Row annotation !${name} has no preceding row`, lineNo);
      // route the entry rows to a discarded sink so they don't cascade
      this.rowAnnotation = { target: new IcfObject(), name, indent };
      return;
    }
    if (!STANDARD_ROW_ANNOTATION_NAMES.has(name) && !name.includes('.')) {
      this.warn('UNKNOWN_ANNOTATION', `Unknown annotation !${name} (not standard, not namespaced)`, lineNo);
    }
    const context: RowAnnotationContext = { target: this.lastRowObject, name, indent };
    this.rowAnnotation = context;
    if (after !== '') {
      // compact form: !name: entry, entry
      this.submitRow(after, lineNo, indent, (text, line) => {
        const entries = splitAndUnescape(text, this.delimiter, this.escape);
        this.checkAnnotationEntries(context.name, entries, line);
        context.target.addRowAnnotationEntries(context.name, entries);
      });
    }
  }

  /** Warns on standard-annotation entries missing their `=` / `:` shape. */
  private checkAnnotationEntries(name: string, entries: string[], lineNo: number): void {
    const needsAssignment = name === 'defaults' || name === 'expressions' || name === 'overrides';
    const needsColon = name === 'constraints';
    if (!needsAssignment && !needsColon) return;
    for (const entry of entries) {
      const idx = needsColon ? entry.indexOf(':') : entry.indexOf('=');
      if (idx <= 0) {
        this.warn(
          'MALFORMED_ANNOTATION_ENTRY',
          `Entry "${entry}" of !${name} is not "${needsColon ? 'field:keyword' : 'key=value'}"`,
          lineNo,
        );
      }
    }
  }

  // ---- shared-index fallback (ICX v1.1 §6) --------------------------------

  private findSharedIndexFields(): string[] | null {
    // `recordindex[]` is the ICX 1.1 shared structure; `index[]` is the
    // legacy ICX 1.0 name (reserved since ICF 1.1), still accepted on read.
    for (const name of ['recordindex', 'index']) {
      for (const schema of this.schemas.asMap().values()) {
        const node = schema.getTopLevelNode(name);
        if (node) return node.getFields();
      }
    }
    return null;
  }

  private synthIndexNode(name: string, collection: boolean): SchemaNode | null {
    const fields = this.findSharedIndexFields();
    if (!fields) return null;
    const node = new SchemaNode(name, collection);
    node.setFields([...fields]);
    return node;
  }

  // ---- masters section --------------------------------------------------

  private masterTypeSchema(name: string): SchemaNode | null {
    // legacy `masters:` container first
    for (const schema of this.schemas.asMap().values()) {
      const masters = schema.getTopLevelNode(IcfMasters.MASTERS_NODE_NAME);
      const child = masters?.getChild(name);
      if (child) return child;
    }
    // top-level collection style
    for (const schema of this.schemas.asMap().values()) {
      const child = schema.getTopLevelNode(name);
      if (child) return child;
    }
    // nested master tables: the type is declared under a grouping/wrapper node
    // (e.g. `masterindextables:` containing `m0000002:` …). Search each schema
    // tree for the first descendant whose name matches.
    for (const schema of this.schemas.asMap().values()) {
      const nested = this.findDescendantNode(schema.getRoot(), name);
      if (nested) return nested;
    }
    // shared index fallback
    return this.synthIndexNode(name, true);
  }

  /** Depth-first search for the first descendant of `node` named `name`. */
  private findDescendantNode(node: SchemaNode, name: string): SchemaNode | null {
    for (const child of node.getChildren().values()) {
      if (child.name === name) return child;
      const deeper = this.findDescendantNode(child, name);
      if (deeper) return deeper;
    }
    return null;
  }

  private handleMastersLine(trimmed: string, indent: number, lineNo: number): void {
    if (trimmed.startsWith('!')) {
      this.handleRowAnnotation(trimmed, indent, lineNo);
      return;
    }
    if (trimmed.startsWith('=') || trimmed.startsWith('-')) {
      const ann = this.rowAnnotation;
      if (ann && indent > ann.indent) {
        // entry row of an open `!annotation:` on the previous master row
        this.submitRow(trimmed.slice(1).trim(), lineNo, indent, (text, line) => {
          const entries = splitAndUnescape(text, this.delimiter, this.escape);
          this.checkAnnotationEntries(ann.name, entries, line);
          ann.target.addRowAnnotationEntries(ann.name, entries);
        });
        return;
      }
      this.rowAnnotation = null;
      if (this.currentMasterType === null) {
        this.error('ROW_WITHOUT_MASTER_TYPE', 'Master row appears before any type declaration', lineNo);
        return;
      }
      const typeName = this.currentMasterType;
      const schema = this.masterTypeSchema(typeName);
      if (schema) {
        const marker = trimmed[0]!;
        if (schema.isCollection() && marker === '=') {
          this.warn('WRONG_ROW_MARKER', `Collection "${typeName}" rows should use "-" (spec §42)`, lineNo);
        } else if (!schema.isCollection() && marker === '-') {
          this.warn('WRONG_ROW_MARKER', `Singleton "${typeName}" rows should use "=" (spec §41)`, lineNo);
        }
      }
      this.submitRow(trimmed.slice(1), lineNo, indent, (text, line) => {
        this.addMasterRow(typeName, schema, text, line);
      });
      return;
    }
    this.rowAnnotation = null;

    const colon = this.firstUnescapedColon(trimmed);
    if (colon < 0) {
      this.warn('UNEXPECTED_MASTERS_LINE', `Not a master declaration: "${trimmed}"`, lineNo);
      return;
    }
    let namePart = trimmed.slice(0, colon).trim();
    if (namePart.endsWith('[]')) namePart = namePart.slice(0, -2);
    const name = unescape(namePart, this.escape);
    const after = trimmed.slice(colon + 1).trim();

    this.currentMasterType = name;
    this.masters.putType(name);
    const schema = this.masterTypeSchema(name);
    if (!schema) {
      this.warn('UNKNOWN_MASTER_TYPE', `Master type "${name}" is not declared in any schema`, lineNo);
    }

    if (after !== '') {
      // compact master row: Type:val, val, ...
      if (schema?.isCollection()) {
        this.warn(
          'COMPACT_COLLECTION_SYNTAX',
          `Compact object syntax on collection "${name}" (spec §43: singletons only)`,
          lineNo,
        );
      }
      this.submitRow(after, lineNo, indent, (text, line) => {
        this.addMasterRow(name, schema, text, line);
      });
    }
  }

  private addMasterRow(typeName: string, schema: SchemaNode | null, text: string, line: number): void {
    const fields = schema ? schema.getFields() : [];
    const values = splitAndUnescape(text, this.delimiter, this.escape);
    const obj = this.buildObject(fields, values, line);
    this.masters.putType(typeName).add(obj);
    this.lastRowObject = obj;
    this.registerRow(schema, obj, line);
  }

  // ---- data section -----------------------------------------------------

  private startRecord(attrStr: string, lineNo: number): void {
    this.section = Section.DATA;
    const attributes = this.parseAttributes(attrStr);
    const schemaId = attributes.get('schema') ?? null;
    let schema = this.schemas.get(schemaId);
    if (schemaId !== null && !this.schemas.has(schemaId)) {
      this.warn('UNKNOWN_SCHEMA_ID', `Record references unknown schema id "${schemaId}"`, lineNo);
      schema = this.schemas.getDefault();
    }
    if (!schema) schema = this.schemas.getDefault();
    const recordSchema = schema ?? new IcfSchema();

    const data = new IcfObject();
    this.records.push(new IcfRecord(attributes, data));
    this.recordLines.push(lineNo);
    this.hasRecord = true;
    this.lastRowObject = null;
    this.rowAnnotation = null;
    this.dataStack = [{ kind: 'container', node: data, schemaNode: recordSchema.getRoot(), indent: -1 }];
  }

  private ensureRecord(lineNo: number): void {
    if (this.hasRecord && this.dataStack.length > 0) return;
    this.warn('IMPLICIT_RECORD', 'Data appears before any @record; an implicit record was created', lineNo);
    this.startRecord('', lineNo);
  }

  private popData(indent: number): void {
    while (this.dataStack.length > 1 && this.dataStack[this.dataStack.length - 1]!.indent >= indent) {
      this.dataStack.pop();
    }
  }

  private handleDataLine(raw: string, trimmed: string, indent: number, lineNo: number): void {
    this.ensureRecord(lineNo);

    if (trimmed.startsWith('!')) {
      this.handleRowAnnotation(trimmed, indent, lineNo);
      return;
    }
    if (trimmed.startsWith('<<')) {
      this.rowAnnotation = null;
      this.openTextBlock(trimmed, indent, lineNo);
      return;
    }
    if (trimmed.startsWith('=') || trimmed.startsWith('-')) {
      const ann = this.rowAnnotation;
      if (ann && indent > ann.indent) {
        // entry row of an open `!annotation:` on the previous data row
        this.submitRow(trimmed.slice(1).trim(), lineNo, indent, (text, line) => {
          const entries = splitAndUnescape(text, this.delimiter, this.escape);
          this.checkAnnotationEntries(ann.name, entries, line);
          ann.target.addRowAnnotationEntries(ann.name, entries);
        });
        return;
      }
      this.rowAnnotation = null;
      this.handleRow(trimmed.slice(1), indent, lineNo, trimmed[0]!);
      return;
    }
    this.rowAnnotation = null;
    if (trimmed.startsWith('[')) {
      this.warn('UNEXPECTED_DATA_LINE', `Field lists are not allowed in @data: "${trimmed}"`, lineNo);
      return;
    }
    this.handleNodeDecl(trimmed, indent, lineNo, raw);
  }

  private handleNodeDecl(trimmed: string, indent: number, lineNo: number, _raw: string): void {
    const colon = this.firstUnescapedColon(trimmed);
    if (colon < 0) {
      this.warn('UNEXPECTED_DATA_LINE', `Not a data node declaration: "${trimmed}"`, lineNo);
      return;
    }
    const namePart = trimmed.slice(0, colon);
    const after = trimmed.slice(colon + 1);
    const name = unescape(namePart.trim(), this.escape);

    // Compact object syntax (spec §12): no whitespace in the name part and
    // at least one character after the colon.
    const isCompact = after.trim() !== '' && !/\s/.test(namePart);

    this.popData(indent);
    const parent = this.dataStack[this.dataStack.length - 1]!;
    if (parent.kind !== 'container') {
      this.error(
        'CHILD_IN_COLLECTION',
        `Node "${name}" cannot be declared under a ${parent.kind} node`,
        lineNo,
      );
      return;
    }
    const parentObject = parent.node;
    const isTopLevel = parent.indent === -1;

    let schemaChild = parent.schemaNode.getChild(name) ?? null;
    if (!schemaChild && isTopLevel) {
      schemaChild = this.synthIndexNode(name, true);
    }
    if (!schemaChild) {
      this.warn('UNKNOWN_NODE', `No schema declaration for node "${name}"`, lineNo);
      return;
    }

    if (schemaChild.isLeaf()) {
      if (schemaChild.isCollection()) {
        const arr = new IcfArray();
        parentObject.set(name, arr);
        const frame: DataFrame = { kind: 'collection', node: arr, schemaNode: schemaChild, indent };
        this.dataStack.push(frame);
        if (isCompact) {
          this.warn(
            'COMPACT_COLLECTION_SYNTAX',
            `Compact object syntax on collection "${name}" (spec §43: singletons only)`,
            lineNo,
          );
          this.submitRow(after, lineNo, indent, (text, line) => this.appendCollectionRow(frame, text, line));
        }
      } else {
        const frame: Extract<DataFrame, { kind: 'leaf' }> = {
          kind: 'leaf',
          parentObject,
          name,
          schemaNode: schemaChild,
          indent,
          filled: false,
        };
        this.dataStack.push(frame);
        if (isCompact) this.submitRow(after, lineNo, indent, (text, line) => this.fillLeaf(frame, text, line));
      }
    } else {
      if (isCompact) {
        this.error('ROW_ON_CONTAINER', `Container node "${name}" cannot carry an inline row`, lineNo);
      }
      const obj = new IcfObject();
      parentObject.set(name, obj);
      this.dataStack.push({ kind: 'container', node: obj, schemaNode: schemaChild, indent });
    }
  }

  private handleRow(rawValue: string, indent: number, lineNo: number, marker: string): void {
    this.popData(indent);
    const owner = this.dataStack[this.dataStack.length - 1]!;
    if (owner.kind === 'collection') {
      if (marker === '=') {
        this.warn('WRONG_ROW_MARKER', `Collection rows should use "-" (spec §42)`, lineNo);
      }
      this.submitRow(rawValue, lineNo, indent, (text, line) => this.appendCollectionRow(owner, text, line));
    } else if (owner.kind === 'leaf') {
      if (marker === '-') {
        this.warn('WRONG_ROW_MARKER', `Singleton object rows should use "=" (spec §41)`, lineNo);
      }
      if (owner.filled) {
        this.error('MULTIPLE_ROWS_FOR_OBJECT', `Leaf object "${owner.name}" already has a row`, lineNo);
      }
      this.submitRow(rawValue, lineNo, indent, (text, line) => this.fillLeaf(owner, text, line));
    } else if (owner.indent === -1) {
      this.error('ROW_WITHOUT_OWNER', 'Row appears with no owning node', lineNo);
    } else {
      this.error('ROW_ON_CONTAINER', 'Row appears under a container node', lineNo);
    }
  }

  private fillLeaf(frame: Extract<DataFrame, { kind: 'leaf' }>, rawValue: string, lineNo: number): void {
    const values = splitAndUnescape(rawValue, this.delimiter, this.escape);
    const obj = this.buildObject(frame.schemaNode.getFields(), values, lineNo);
    frame.parentObject.set(frame.name, obj);
    frame.filled = true;
    this.lastRowObject = obj;
    this.registerRow(frame.schemaNode, obj, lineNo);
  }

  private appendCollectionRow(
    frame: Extract<DataFrame, { kind: 'collection' }>,
    rawValue: string,
    lineNo: number,
  ): void {
    const values = splitAndUnescape(rawValue, this.delimiter, this.escape);
    const obj = this.buildObject(frame.schemaNode.getFields(), values, lineNo);
    frame.node.add(obj);
    this.lastRowObject = obj;
    this.registerRow(frame.schemaNode, obj, lineNo);
  }

  /** Registers a row against its schema node for `!constraints` validation. */
  private registerRow(node: SchemaNode | null, obj: IcfObject, line: number): void {
    if (!node) return;
    const rows = this.rowsByNode.get(node);
    if (rows) rows.push({ obj, line });
    else this.rowsByNode.set(node, [{ obj, line }]);
  }

  private buildObject(fields: string[], values: string[], lineNo: number): IcfObject {
    const obj = new IcfObject();
    const record =
      this.section === Section.DATA && this.records.length > 0
        ? this.records[this.records.length - 1]!
        : null;
    for (const v of values) {
      if (REFERENCE_CANDIDATE.test(v)) this.refChecks.push({ line: lineNo, value: v, record });
    }
    if (fields.length === 0) {
      // No declared fields — synthesize positional field names so the data
      // is still navigable (e.g. masters with no schema).
      values.forEach((v, i) => obj.set(`field${i + 1}`, this.valueNode(v)));
      return obj;
    }
    if (values.length !== fields.length) {
      this.warn(
        'FIELD_COUNT_MISMATCH',
        `Expected ${fields.length} value(s) but found ${values.length}`,
        lineNo,
      );
    }
    for (let i = 0; i < fields.length; i++) {
      if (i < values.length) obj.set(fields[i]!, this.valueNode(values[i]!));
    }
    return obj;
  }

  /** A bare `null` literal → {@link NULL}; everything else → {@link IcfString}. */
  private valueNode(value: string): IcfNode {
    return value === 'null' ? NULL : new IcfString(value);
  }

  // ---- record attributes ------------------------------------------------

  private parseAttributes(attrStr: string): Map<string, string> {
    const map = new Map<string, string>();
    const tokens = this.splitOnUnescapedWhitespace(attrStr);
    for (const tok of tokens) {
      const eq = tok.indexOf('=');
      if (eq < 0) {
        this.warn('ATTRIBUTE_WITHOUT_VALUE', `Record attribute "${tok}" has no value`, 0);
        map.set(unescape(tok.trim(), this.escape), '');
        continue;
      }
      const key = tok.slice(0, eq).trim();
      const value = unescape(tok.slice(eq + 1).trim(), this.escape);
      map.set(key, value);
    }
    return map;
  }

  private splitOnUnescapedWhitespace(s: string): string[] {
    const tokens: string[] = [];
    let current = '';
    for (let i = 0; i < s.length; i++) {
      const ch = s[i]!;
      if (ch === this.escape && i + 1 < s.length) {
        current += ch + s[i + 1]!;
        i++;
        continue;
      }
      if (ch === ' ' || ch === '\t') {
        if (current !== '') {
          tokens.push(current);
          current = '';
        }
        continue;
      }
      current += ch;
    }
    if (current !== '') tokens.push(current);
    return tokens;
  }

  // ---- text blocks ------------------------------------------------------

  private openTextBlock(trimmed: string, indent: number, lineNo: number): void {
    const tag = trimmed.slice(2);
    if (tag === '' || /\s/.test(tag)) {
      this.warn('UNEXPECTED_DATA_LINE', `Text block opening tag must be alone: "${trimmed}"`, lineNo);
      return;
    }
    this.popData(indent);
    const owner = this.dataStack[this.dataStack.length - 1]!;
    if (owner.kind !== 'leaf') {
      this.error('TEXT_BLOCK_WITHOUT_OWNER', `Text block <<${tag} has no owning leaf node`, lineNo);
      this.textBlockOwner = null;
    } else {
      this.textBlockOwner = owner;
    }
    this.inTextBlock = true;
    this.textBlockTag = tag;
    this.textBlockIndent = indent;
    this.textBlockBuffer = [];
  }

  private handleTextBlockLine(raw: string, _lineNo: number): void {
    const { indent } = this.indentOf(raw);
    if (indent === this.textBlockIndent && raw.trim() === `${this.textBlockTag}>>`) {
      this.closeTextBlock();
      return;
    }
    this.textBlockBuffer.push(this.stripIndent(raw, this.textBlockIndent));
  }

  private stripIndent(line: string, n: number): string {
    let removed = 0;
    let i = 0;
    while (i < line.length && removed < n && (line[i] === ' ' || line[i] === '\t')) {
      i++;
      removed++;
    }
    return line.slice(i);
  }

  private closeTextBlock(): void {
    const value = this.textBlockBuffer.join('\n');
    const owner = this.textBlockOwner;
    if (owner) {
      const fieldName = owner.schemaNode.getFields()[0] ?? 'field1';
      const obj = new IcfObject();
      obj.set(fieldName, new IcfString(value));
      owner.parentObject.set(owner.name, obj);
      owner.filled = true;
    }
    this.inTextBlock = false;
    this.textBlockOwner = null;
    this.textBlockBuffer = [];
  }

  // ---- final validation -------------------------------------------------

  private finalValidation(): void {
    if (this.schemas.isEmpty()) {
      this.warn('NO_SCHEMA', 'Document declares no @schema', 0);
    } else {
      for (const [id, schema] of this.schemas.asMap()) {
        if (schema.isEmpty()) {
          this.warn('EMPTY_SCHEMA', `Schema "${id || '(default)'}" declares no nodes`, 0);
        }
      }
    }

    // Primary objects (spec v1.1 §39): every name in `primary=` must exist
    // as an object within the record body. Non-fatal.
    for (let i = 0; i < this.records.length; i++) {
      const record = this.records[i]!;
      for (const name of record.getPrimary()) {
        if (!containsNodeNamed(record.getData(), name)) {
          this.warn(
            'PRIMARY_OBJECT_NOT_FOUND',
            `Primary object "${name}" does not exist in the record`,
            this.recordLines[i] ?? 0,
          );
        }
      }
    }

    // Referential integrity (spec v1.1 §44–§45): a `Type:Id` value resolves
    // record-local primary objects first, then declared master types. This
    // covers references in @data records AND master-to-master (foreign-key)
    // references inside @masters. Non-fatal — values are never rejected.
    for (const { line, value, record } of this.refChecks) {
      const idx = value.indexOf(':');
      const type = value.slice(0, idx);
      const id = value.slice(idx + 1);
      if (record !== null && record.getPrimary().includes(type)) {
        if (findPrimaryObject(record.getData(), type, id) !== null) continue;
        // spec §45 order: a primary miss still falls back to global masters
        if (this.masters.hasType(type) && this.masters.resolveReference(value) !== null) continue;
        this.warn(
          'UNRESOLVED_PRIMARY_REFERENCE',
          `Reference "${value}" does not resolve to any record-local "${type}" primary object`,
          line,
        );
        continue;
      }
      // whole value first — a master ID containing `+` still resolves whole
      if (this.masters.hasType(type) && this.masters.resolveReference(value) !== null) continue;
      // split fallback (ICX v1.2 §7): a joined tag cell is validated per tag
      if (hasUnescapedJoin(value)) {
        for (const part of splitTags(value)) {
          if (!REFERENCE_CANDIDATE.test(part)) continue; // bare keyword tag
          const partType = part.slice(0, part.indexOf(':'));
          if (!this.masters.hasType(partType)) continue;
          if (this.masters.resolveReference(part) === null) {
            this.warn(
              'UNRESOLVED_MASTER_REFERENCE',
              `Reference "${part}" does not resolve to any "${partType}" master record`,
              line,
            );
          }
        }
        continue;
      }
      if (!this.masters.hasType(type)) continue; // not a master reference
      this.warn(
        'UNRESOLVED_MASTER_REFERENCE',
        `Reference "${value}" does not resolve to any "${type}" master record`,
        line,
      );
    }

    this.validateConstraints();
  }

  // `!constraints` (spec v1.1 §29, §65): `required` and `unique`, validated
  // over every row bound to the schema object across the whole document
  // (masters + all records). Warnings only — never invalidates the document.
  private validateConstraints(): void {
    const unknownKeywords = new Set<string>();
    for (const [node, rows] of this.rowsByNode) {
      for (const [field, keywords] of node.getConstraints()) {
        for (const keyword of keywords) {
          if (keyword === 'required') {
            for (const { obj, line } of rows) {
              const v = obj.get(field);
              if (!v || v.isMissing() || (v.isString() && v.asText() === '')) {
                this.warn(
                  'REQUIRED_FIELD_MISSING',
                  `Required field "${field}" of "${node.name}" is missing or empty`,
                  line,
                );
              }
            }
          } else if (keyword === 'unique') {
            const seen = new Set<string>();
            for (const { obj, line } of rows) {
              const v = obj.get(field);
              if (!v || v.isNull() || v.isMissing()) continue;
              const text = v.asText();
              if (text === '') continue;
              if (seen.has(text)) {
                this.warn(
                  'UNIQUE_CONSTRAINT_VIOLATION',
                  `Duplicate value "${text}" for unique field "${field}" of "${node.name}"`,
                  line,
                );
              } else {
                seen.add(text);
              }
            }
          } else if (!unknownKeywords.has(keyword)) {
            unknownKeywords.add(keyword); // once per keyword, document-wide
            this.warn(
              'UNKNOWN_CONSTRAINT',
              `Unknown constraint keyword "${keyword}" on field "${field}" of "${node.name}"`,
              0,
            );
          }
        }
      }
    }
  }
}

/** True when the object tree contains a field named `name` at any depth. */
function containsNodeNamed(data: IcfObject, name: string): boolean {
  for (const [key, value] of data.fields()) {
    if (key === name) return true;
    if (value.isObject() && containsNodeNamed(value, name)) return true;
  }
  return false;
}

function lineNo(lines: string[]): number {
  return lines.length;
}
