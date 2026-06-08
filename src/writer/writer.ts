/**
 * The schema-driven ICF serializer.
 *
 * Mirrors icfj's `IcfWriter`. `write(IcfDocument)` is the round-trip-faithful
 * path; `write(IcfNode)` infers a schema first. Both are **synchronous and
 * checksum-free**; checksum injection happens via {@link writeWithChecksum} on
 * the facade, which precomputes the (async) hash and passes it in.
 */

import { IcfWriteError } from '../errors.js';
import { IcfDocument, IcfRecord } from '../document.js';
import { IcfMetadata } from '../model/metadata.js';
import { IcfMasters } from '../model/masters.js';
import { IcfNode, IcfObject } from '../model/node.js';
import { IcfSchema, IcfSchemas, SchemaNode } from '../model/schema.js';
import { escape as escapeName, escapeAttribute, escapeValue } from '../parser/escaper.js';
import { SchemaInference } from './inference.js';

/** Customizes writer output. Fluent setters return `this`. */
export class WriterOptions {
  indentWidth = 2;
  newline = '\n';
  scalarArrayField = 'value';
  textBlocksEnabled = true;
  textBlockTag = 'TEXT';
  computeChecksum = false;

  static defaults(): WriterOptions {
    return new WriterOptions();
  }

  /** Builds options from a plain partial object (JS-idiomatic shape). */
  static from(partial?: Partial<WriterOptions> | WriterOptions): WriterOptions {
    const opts = new WriterOptions();
    if (partial) Object.assign(opts, partial);
    return opts;
  }

  setIndentWidth(n: number): this {
    this.indentWidth = n;
    return this;
  }
  setNewline(s: string): this {
    this.newline = s;
    return this;
  }
  setScalarArrayField(s: string): this {
    this.scalarArrayField = s;
    return this;
  }
  setTextBlocksEnabled(b: boolean): this {
    this.textBlocksEnabled = b;
    return this;
  }
  setTextBlockTag(s: string): this {
    this.textBlockTag = s;
    return this;
  }
  setComputeChecksum(b: boolean): this {
    this.computeChecksum = b;
    return this;
  }
}

/** Finds the schema node describing a master type, mirroring the parser. */
export function findMasterTypeSchema(
  schemas: IcfSchemas,
  typeName: string,
): SchemaNode | null {
  for (const schema of schemas.asMap().values()) {
    const masters = schema.getTopLevelNode(IcfMasters.MASTERS_NODE_NAME);
    const child = masters?.getChild(typeName);
    if (child) return child;
  }
  for (const schema of schemas.asMap().values()) {
    const child = schema.getTopLevelNode(typeName);
    if (child) return child;
  }
  return null;
}

export class IcfWriter {
  private readonly options: WriterOptions;

  constructor(options?: Partial<WriterOptions> | WriterOptions) {
    this.options = options instanceof WriterOptions ? options : WriterOptions.from(options);
  }

  /** Serializes a document or built node (sync, checksum-free). */
  writeToString(target: IcfDocument | IcfNode): string {
    return this.render(this.toDocument(target), undefined);
  }

  /**
   * Serializes with a precomputed `@checksum` (or `null` to omit it while
   * still dropping any stored value). Used by the async facade.
   */
  writeToStringWithChecksum(target: IcfDocument | IcfNode, checksum: string | null): string {
    return this.render(this.toDocument(target), checksum);
  }

  /** Resolves a target to a document, inferring a schema for built nodes. */
  toDocument(target: IcfDocument | IcfNode): IcfDocument {
    if (target instanceof IcfDocument) return target;
    const schema = new SchemaInference(this.options.scalarArrayField).infer(target);
    const records: IcfRecord[] = [];
    if (target.isArray()) {
      for (const el of target.elements()) {
        if (!el.isObject()) throw new IcfWriteError('Record array elements must be objects');
        records.push(new IcfRecord(new Map(), el));
      }
    } else if (target.isObject()) {
      records.push(new IcfRecord(new Map(), target));
    } else {
      throw new IcfWriteError('Record root must be an object or array');
    }
    const metadata = new IcfMetadata();
    return new IcfDocument(metadata, schema, new IcfMasters(), records);
  }

  // ---- top-level render -------------------------------------------------

  private render(doc: IcfDocument, injectedChecksum: string | null | undefined): string {
    const checksumMode = injectedChecksum !== undefined;
    const lines: string[] = [];
    const meta = doc.getMetadata();
    const delimiter = meta.getDelimiterChar();
    const escapeChar = meta.getEscapeChar();

    // 1) @kind first
    lines.push(`@kind ${meta.getKind() ?? 'icf'}`);

    // 2) generic directives (skip kind / records; drop checksum in checksum mode)
    for (const [name, value] of meta.asMap()) {
      const lower = name.toLowerCase();
      if (lower === 'kind' || lower === 'records') continue;
      if (checksumMode && lower === 'checksum') continue;
      lines.push(value === '' ? `@${name}` : `@${name} ${value}`);
    }

    // 3) @records (explicit value if present, else computed)
    const records = meta.getRecords();
    lines.push(`@records ${records ?? String(doc.getRecordCount())}`);

    // 4) injected @checksum
    if (checksumMode && injectedChecksum) lines.push(`@checksum ${injectedChecksum}`);

    // 5) @metadata section
    if (meta.hasUserMetadata()) {
      lines.push('', '@metadata', '');
      for (const [k, v] of meta.userMetadataAsMap()) lines.push(`${k}: ${v}`);
    }

    // 6) schema blocks
    for (const [id, schema] of doc.getSchemas().asMap()) {
      lines.push('');
      lines.push(id === IcfSchemas.DEFAULT_ID ? '@schema' : `@schema id=${id}`);
      lines.push('');
      this.writeSchema(schema, lines, delimiter, escapeChar);
    }

    // 7) @masters section
    if (doc.hasMasters()) {
      lines.push('', '@masters', '');
      this.writeMasters(doc, lines, delimiter, escapeChar);
    }

    // 8) @data section
    lines.push('', '@data');
    for (const record of doc.getRecords()) {
      this.writeRecord(doc, record, lines, delimiter, escapeChar);
    }

    return lines.join(this.options.newline) + this.options.newline;
  }

  // ---- schema -----------------------------------------------------------

  private writeSchema(schema: IcfSchema, lines: string[], delimiter: string, escapeChar: string): void {
    for (const node of schema.getTopLevelNodes().values()) {
      this.writeSchemaNode(node, 0, lines, delimiter, escapeChar);
      lines.push('');
    }
    if (lines[lines.length - 1] === '') lines.pop();
  }

  private writeSchemaNode(
    node: SchemaNode,
    depth: number,
    lines: string[],
    delimiter: string,
    escapeChar: string,
  ): void {
    const indent = ' '.repeat(depth * this.options.indentWidth);
    const marker = node.isCollection() ? '[]' : '';
    lines.push(`${indent}${escapeName(node.name, delimiter, escapeChar)}${marker}:`);
    if (node.getFields().length > 0) {
      const fieldIndent = ' '.repeat((depth + 1) * this.options.indentWidth);
      const fields = node.getFields().map((f) => escapeName(f, delimiter, escapeChar));
      lines.push(`${fieldIndent}[${fields.join(', ')}]`);
    }
    for (const child of node.getChildren().values()) {
      this.writeSchemaNode(child, depth + 1, lines, delimiter, escapeChar);
    }
  }

  // ---- masters ----------------------------------------------------------

  private writeMasters(doc: IcfDocument, lines: string[], delimiter: string, escapeChar: string): void {
    const masters = doc.getMasters();
    const rowIndent = ' '.repeat(this.options.indentWidth);
    for (const type of masters.getTypes()) {
      const schemaNode = findMasterTypeSchema(doc.getSchemas(), type);
      const entries = masters.getType(type)!.elements();
      const collection = schemaNode ? schemaNode.isCollection() : entries.length > 1;
      const marker = collection ? '-' : '=';
      lines.push(`${escapeName(type, delimiter, escapeChar)}:`);
      for (const el of entries) {
        if (!el.isObject()) throw new IcfWriteError(`Master entry of type "${type}" is not an object`);
        const fields = schemaNode && schemaNode.getFields().length > 0 ? schemaNode.getFields() : el.fieldNames();
        lines.push(`${rowIndent}${marker} ${this.renderRow(el, fields, delimiter, escapeChar)}`);
      }
      lines.push('');
    }
    if (lines[lines.length - 1] === '') lines.pop();
  }

  // ---- records ----------------------------------------------------------

  private writeRecord(
    doc: IcfDocument,
    record: IcfRecord,
    lines: string[],
    delimiter: string,
    escapeChar: string,
  ): void {
    lines.push('');
    const attrs: string[] = [];
    for (const [k, v] of record.getAttributes()) {
      attrs.push(`${k}=${escapeAttribute(v, escapeChar)}`);
    }
    lines.push(attrs.length > 0 ? `@record ${attrs.join(' ')}` : '@record');
    lines.push('');

    const schema = this.recordSchema(doc, record);
    const data = record.getData();
    for (const [name, schemaNode] of schema.getRoot().getChildren()) {
      const childData = data.get(name);
      if (childData) this.writeDataNode(name, childData, schemaNode, 0, lines, delimiter, escapeChar);
    }
  }

  /**
   * Canonical body text of a single record (its data-node lines, LF-joined,
   * without the `@record` line or attributes). Used for ICX record checksums
   * (ICX §7: record body included, directive + attributes excluded).
   */
  recordBody(doc: IcfDocument, record: IcfRecord): string {
    const lines: string[] = [];
    const meta = doc.getMetadata();
    const delimiter = meta.getDelimiterChar();
    const escapeChar = meta.getEscapeChar();
    const schema = this.recordSchema(doc, record);
    const data = record.getData();
    for (const [name, schemaNode] of schema.getRoot().getChildren()) {
      const childData = data.get(name);
      if (childData) this.writeDataNode(name, childData, schemaNode, 0, lines, delimiter, escapeChar);
    }
    return lines.join('\n');
  }

  /** Canonical row value text of one master entry (for ICX master checksums). */
  masterRow(doc: IcfDocument, type: string, entry: IcfObject): string {
    const meta = doc.getMetadata();
    const delimiter = meta.getDelimiterChar();
    const escapeChar = meta.getEscapeChar();
    const schemaNode = findMasterTypeSchema(doc.getSchemas(), type);
    const fields =
      schemaNode && schemaNode.getFields().length > 0 ? schemaNode.getFields() : entry.fieldNames();
    return this.renderRow(entry, fields, delimiter, escapeChar);
  }

  private recordSchema(doc: IcfDocument, record: IcfRecord): IcfSchema {
    const id = record.getSchemaId();
    return doc.getSchemas().get(id) ?? doc.getSchemas().getDefault() ?? new IcfSchema();
  }

  private writeDataNode(
    name: string,
    data: IcfNode,
    schemaNode: SchemaNode,
    depth: number,
    lines: string[],
    delimiter: string,
    escapeChar: string,
  ): void {
    const indent = ' '.repeat(depth * this.options.indentWidth);
    const nodeName = escapeName(name, delimiter, escapeChar);

    if (!schemaNode.isLeaf()) {
      // container
      lines.push(`${indent}${nodeName}:`);
      lines.push('');
      for (const [childName, childSchema] of schemaNode.getChildren()) {
        const childData = data.get(childName);
        if (childData) {
          this.writeDataNode(childName, childData, childSchema, depth + 1, lines, delimiter, escapeChar);
        }
      }
      return;
    }

    if (schemaNode.isCollection()) {
      lines.push(`${indent}${nodeName}:`);
      const rowIndent = ' '.repeat((depth + 1) * this.options.indentWidth);
      for (const el of data.elements()) {
        const row = el.isObject()
          ? this.renderRow(el, schemaNode.getFields(), delimiter, escapeChar)
          : this.renderScalar(el, delimiter, escapeChar);
        lines.push(`${rowIndent}- ${row}`);
      }
      return;
    }

    // leaf object
    if (this.options.textBlocksEnabled && this.tryTextBlock(name, data, schemaNode, depth, lines)) {
      return;
    }
    lines.push(`${indent}${nodeName}:`);
    const rowIndent = ' '.repeat((depth + 1) * this.options.indentWidth);
    lines.push(`${rowIndent}= ${this.renderRow(data, schemaNode.getFields(), delimiter, escapeChar)}`);
  }

  private tryTextBlock(
    name: string,
    data: IcfNode,
    schemaNode: SchemaNode,
    depth: number,
    lines: string[],
  ): boolean {
    if (!data.isObject() || data.size !== 1) return false;
    const fieldName = schemaNode.getFields()[0] ?? data.fieldNames()[0]!;
    const value = data.get(fieldName);
    if (!value || !value.isString()) return false;
    const text = value.textValue!;
    if (!text.includes('\n')) return false;

    const tag = this.options.textBlockTag;
    if (text.includes(`${tag}>>`)) return false; // collision — fall back to escaped form

    const indent = ' '.repeat(depth * this.options.indentWidth);
    const blockIndent = ' '.repeat((depth + 1) * this.options.indentWidth);
    lines.push(`${indent}${name}:`);
    lines.push('');
    lines.push(`${blockIndent}<<${tag}`);
    for (const contentLine of text.split('\n')) {
      lines.push(blockIndent + contentLine);
    }
    lines.push(`${blockIndent}${tag}>>`);
    return true;
  }

  private renderRow(obj: IcfNode, fields: string[], delimiter: string, escapeChar: string): string {
    const cells = fields.map((field) => {
      const v = obj.get(field);
      if (!v || v.isMissing()) return '';
      if (v.isNull()) return 'null';
      if (v.isString()) return escapeValue(v.textValue!, delimiter, escapeChar);
      throw new IcfWriteError(`Row value for field "${field}" is a container (not representable)`);
    });
    return cells.join(`${delimiter} `);
  }

  private renderScalar(node: IcfNode, delimiter: string, escapeChar: string): string {
    if (node.isNull()) return 'null';
    if (node.isString()) return escapeValue(node.textValue!, delimiter, escapeChar);
    throw new IcfWriteError('Scalar collection element is a container (not representable)');
  }
}

/**
 * Canonical content bytes for checksums (spec §19): re-serialize with default
 * options and slice from the line that is exactly `@schema` or starts with
 * `@schema ` (so `@schema-url` is excluded). UTF-8 encoded.
 */
export function canonicalContentBytes(doc: IcfDocument): Uint8Array {
  const text = new IcfWriter().writeToString(doc);
  const lines = text.split('\n');
  let start = lines.findIndex((l) => l === '@schema' || l.startsWith('@schema '));
  if (start < 0) start = 0;
  const sliced = lines.slice(start).join('\n');
  return new TextEncoder().encode(sliced);
}
