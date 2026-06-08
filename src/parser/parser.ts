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

export class IcfParser {
  /** Highest ICF major version this parser implements. */
  static readonly SUPPORTED_MAJOR_VERSION = 1;
  /** Highest ICF minor version this parser implements. */
  static readonly SUPPORTED_MINOR_VERSION = 0;

  private readonly messages: ValidationMessage[] = [];
  private metadata!: IcfMetadata;
  private schemas!: IcfSchemas;
  private masters!: IcfMasters;
  private records!: IcfRecord[];

  private section = Section.HEADER;

  // schema parsing state
  private currentSchema: IcfSchema | null = null;
  private schemaStack: SchemaFrame[] = [];

  // masters parsing state
  private currentMasterType: string | null = null;

  // data parsing state
  private dataStack: DataFrame[] = [];
  private hasRecord = false;

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
      if (trimmed === '') continue; // empty lines ignored outside text blocks

      const { indent, hadTab } = this.indentOf(raw);
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
    this.popSchema(indent);
    const parent = this.schemaStack[this.schemaStack.length - 1]!.node;
    if (parent.hasChild(name)) {
      this.warn('DUPLICATE_NODE', `Duplicate schema node "${name}"`, lineNo);
    }
    const node = new SchemaNode(name, collection);
    parent.addChild(node);
    this.schemaStack.push({ node, indent });
  }

  // ---- shared-index fallback (ICX §5) -----------------------------------

  private findSharedIndexFields(): string[] | null {
    for (const schema of this.schemas.asMap().values()) {
      const index = schema.getTopLevelNode('index');
      if (index) return index.getFields();
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
    // shared index fallback
    return this.synthIndexNode(name, true);
  }

  private handleMastersLine(trimmed: string, _indent: number, lineNo: number): void {
    if (trimmed.startsWith('=') || trimmed.startsWith('-')) {
      if (this.currentMasterType === null) {
        this.error('ROW_WITHOUT_MASTER_TYPE', 'Master row appears before any type declaration', lineNo);
        return;
      }
      const rest = trimmed.slice(1);
      const schema = this.masterTypeSchema(this.currentMasterType);
      const fields = schema ? schema.getFields() : [];
      const values = splitAndUnescape(rest, this.delimiter, this.escape);
      const obj = this.buildObject(fields, values, lineNo);
      this.masters.putType(this.currentMasterType).add(obj);
      return;
    }

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
      const fields = schema ? schema.getFields() : [];
      const values = splitAndUnescape(after, this.delimiter, this.escape);
      this.masters.putType(name).add(this.buildObject(fields, values, lineNo));
    }
  }

  // ---- data section -----------------------------------------------------

  private startRecord(attrStr: string, _lineNo: number): void {
    this.section = Section.DATA;
    const attributes = this.parseAttributes(attrStr);
    const schemaId = attributes.get('schema') ?? null;
    let schema = this.schemas.get(schemaId);
    if (schemaId !== null && !this.schemas.has(schemaId)) {
      this.warn('UNKNOWN_SCHEMA_ID', `Record references unknown schema id "${schemaId}"`, _lineNo);
      schema = this.schemas.getDefault();
    }
    if (!schema) schema = this.schemas.getDefault();
    const recordSchema = schema ?? new IcfSchema();

    const data = new IcfObject();
    this.records.push(new IcfRecord(attributes, data));
    this.hasRecord = true;
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

    if (trimmed.startsWith('<<')) {
      this.openTextBlock(trimmed, indent, lineNo);
      return;
    }
    if (trimmed.startsWith('=') || trimmed.startsWith('-')) {
      this.handleRow(trimmed.slice(1), indent, lineNo);
      return;
    }
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
        if (isCompact) this.appendCollectionRow(frame, after, lineNo);
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
        if (isCompact) this.fillLeaf(frame, after, lineNo);
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

  private handleRow(rawValue: string, indent: number, lineNo: number): void {
    this.popData(indent);
    const owner = this.dataStack[this.dataStack.length - 1]!;
    if (owner.kind === 'collection') {
      this.appendCollectionRow(owner, rawValue, lineNo);
    } else if (owner.kind === 'leaf') {
      if (owner.filled) {
        this.error('MULTIPLE_ROWS_FOR_OBJECT', `Leaf object "${owner.name}" already has a row`, lineNo);
      }
      this.fillLeaf(owner, rawValue, lineNo);
    } else if (owner.indent === -1) {
      this.error('ROW_WITHOUT_OWNER', 'Row appears with no owning node', lineNo);
    } else {
      this.error('ROW_ON_CONTAINER', 'Row appears under a container node', lineNo);
    }
  }

  private fillLeaf(frame: Extract<DataFrame, { kind: 'leaf' }>, rawValue: string, lineNo: number): void {
    const values = splitAndUnescape(rawValue, this.delimiter, this.escape);
    frame.parentObject.set(frame.name, this.buildObject(frame.schemaNode.getFields(), values, lineNo));
    frame.filled = true;
  }

  private appendCollectionRow(
    frame: Extract<DataFrame, { kind: 'collection' }>,
    rawValue: string,
    lineNo: number,
  ): void {
    const values = splitAndUnescape(rawValue, this.delimiter, this.escape);
    frame.node.add(this.buildObject(frame.schemaNode.getFields(), values, lineNo));
  }

  private buildObject(fields: string[], values: string[], lineNo: number): IcfObject {
    const obj = new IcfObject();
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
  }
}

function lineNo(lines: string[]): number {
  return lines.length;
}
