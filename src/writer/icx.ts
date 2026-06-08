/**
 * Generates an ICX companion index as another {@link IcfDocument}.
 *
 * Mirrors icfj's `IcxGenerator`. The ICX is built as a normal ICF document
 * (one anonymous schema of top-level index collections + a single synthetic
 * record) so it serializes — and round-trips — through the standard writer.
 *
 * Checksums are async ({@link generateWithChecksums}); structure-only
 * generation ({@link generate}) leaves positional and checksum fields empty.
 */

import { IcfDocument, IcfRecord } from '../document.js';
import { IcfMetadata } from '../model/metadata.js';
import { IcfMasters } from '../model/masters.js';
import { IcfArray, IcfObject } from '../model/node.js';
import { IcfSchema, SchemaNode } from '../model/schema.js';
import { compute, isSupported } from '../checksum.js';
import { IcfWriter, canonicalContentBytes } from './writer.js';

/** Options for {@link IcxGenerator.generateWithChecksums}. */
export interface IcxChecksumOptions {
  sourceFileName?: string;
  sourceText?: string;
}

interface MasterRowRef {
  type: string;
  entry: IcfObject;
  row: IcfObject;
}

interface RecordRowRef {
  record: IcfRecord;
  row: IcfObject;
}

interface BuildResult {
  doc: IcfDocument;
  meta: IcfMetadata;
  hashMethod: string;
  masterRowRefs: MasterRowRef[];
  recordRowRefs: RecordRowRef[];
}

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

export class IcxGenerator {
  /** The six index fields shared by every master/data index collection. */
  static readonly INDEX_FIELDS: ReadonlyArray<string> = [
    'RecordID',
    'UUID',
    'Line',
    'Offset',
    'Size',
    'Checksum',
  ];
  static readonly SCHEMA_ATTRIBUTE = 'schema';
  static readonly RECORD_TYPE_ATTRIBUTE = 'type';
  static readonly DEFAULT_ICX_VERSION = '1.0';

  /** Builds the ICX index with empty positional and checksum fields. */
  generate(source: IcfDocument, sourceFileName?: string): IcfDocument {
    return this.buildBase(source, sourceFileName).doc;
  }

  /**
   * Builds the ICX index, computing `@sourcechecksum`, `@sourcefilechecksum`,
   * per-record / per-master `Checksum`, and (when `sourceText` is supplied)
   * `Line` / `Offset` / `Size`. Degrades gracefully: if the resolved
   * `@hashmethod` is unregistered, computed fields are left empty.
   */
  async generateWithChecksums(source: IcfDocument, options: IcxChecksumOptions = {}): Promise<IcfDocument> {
    const { sourceFileName, sourceText } = options;
    const base = this.buildBase(source, sourceFileName);
    const { meta, hashMethod } = base;
    const supported = isSupported(hashMethod);

    // @sourcechecksum: copy the ICF's own @checksum if present, else compute
    const existing = source.getMetadata().getChecksum();
    if (existing) {
      meta.put('sourcechecksum', existing);
    } else if (supported) {
      meta.put('sourcechecksum', await compute(hashMethod, canonicalContentBytes(source)));
    }

    // @sourcefilechecksum over the literal source text
    if (sourceText != null && supported) {
      meta.put('sourcefilechecksum', await compute(hashMethod, utf8(sourceText)));
    }

    // per-row checksums
    if (supported) {
      const writer = new IcfWriter();
      for (const ref of base.masterRowRefs) {
        ref.row.set('Checksum', await compute(hashMethod, utf8(writer.masterRow(source, ref.type, ref.entry))));
      }
      for (const ref of base.recordRowRefs) {
        ref.row.set('Checksum', await compute(hashMethod, utf8(writer.recordBody(source, ref.record))));
      }
    }

    // positional fields from the literal source text
    if (sourceText != null) {
      const positions = scanRecordPositions(sourceText);
      base.recordRowRefs.forEach((ref, i) => {
        const pos = positions[i];
        if (pos) {
          ref.row.set('Line', String(pos.line));
          ref.row.set('Offset', String(pos.offset));
          ref.row.set('Size', String(pos.size));
        }
      });
    }

    return base.doc;
  }

  // ---- construction -----------------------------------------------------

  private buildBase(source: IcfDocument, sourceFileName?: string): BuildResult {
    const meta = new IcfMetadata();
    meta.put('kind', 'icx');
    meta.put('version', IcxGenerator.DEFAULT_ICX_VERSION);
    if (sourceFileName) meta.put('source', sourceFileName);

    const hashMethod = source.getMetadata().getHashMethod() ?? IcfMetadata.DEFAULT_HASH_METHOD;
    meta.put('hashmethod', hashMethod);

    // ICX @records = master rows + source records (total index entries)
    const total = source.getMasters().totalEntryCount() + source.getRecordCount();
    meta.put('records', String(total));

    const schema = new IcfSchema();
    const data = new IcfObject();
    const masterRowRefs: MasterRowRef[] = [];
    const recordRowRefs: RecordRowRef[] = [];

    // master index collections
    const masters = source.getMasters();
    for (const type of masters.getTypes()) {
      this.ensureTypeNode(schema, type);
      const arr = getOrCreateArray(data, type);
      for (const entry of masters.getType(type)!.elements()) {
        if (!entry.isObject()) continue;
        const row = arr.addObject();
        this.fillIndexRow(row, firstFieldValue(entry), '');
        masterRowRefs.push({ type, entry, row });
      }
    }

    // data index collections, grouped by record type
    for (const [type, recs] of this.groupRecords(source)) {
      this.ensureTypeNode(schema, type);
      const arr = getOrCreateArray(data, type);
      for (const rec of recs) {
        const row = arr.addObject();
        this.fillIndexRow(row, rec.getId() ?? '', rec.getUuid() ?? '');
        recordRowRefs.push({ record: rec, row });
      }
    }

    const record = new IcfRecord(new Map(), data);
    const doc = new IcfDocument(meta, schema, new IcfMasters(), [record]);
    return { doc, meta, hashMethod, masterRowRefs, recordRowRefs };
  }

  private ensureTypeNode(schema: IcfSchema, type: string): void {
    if (schema.getRoot().hasChild(type)) return;
    const node = new SchemaNode(type, true);
    node.setFields([...IcxGenerator.INDEX_FIELDS]);
    schema.getRoot().addChild(node);
  }

  private fillIndexRow(row: IcfObject, recordId: string, uuid: string): void {
    row.set('RecordID', recordId);
    row.set('UUID', uuid);
    row.set('Line', '');
    row.set('Offset', '');
    row.set('Size', '');
    row.set('Checksum', '');
  }

  private groupRecords(source: IcfDocument): Map<string, IcfRecord[]> {
    const groups = new Map<string, IcfRecord[]>();
    for (const rec of source.getRecords()) {
      const type = this.recordType(source, rec);
      if (!groups.has(type)) groups.set(type, []);
      groups.get(type)!.push(rec);
    }
    return groups;
  }

  private recordType(source: IcfDocument, rec: IcfRecord): string {
    const schemaId = rec.getSchemaId();
    if (schemaId) return schemaId;
    const typeAttr = rec.getAttribute(IcxGenerator.RECORD_TYPE_ATTRIBUTE);
    if (typeAttr) return typeAttr;
    const firstDataField = rec.getData().fieldNames()[0];
    if (firstDataField) return firstDataField;
    const schema = source.getSchema();
    const firstNode = schema ? [...schema.getTopLevelNodes().keys()][0] : undefined;
    return firstNode ?? 'record';
  }
}

function getOrCreateArray(data: IcfObject, name: string): IcfArray {
  const existing = data.get(name);
  if (existing && existing.isArray()) return existing;
  return data.putArray(name);
}

function firstFieldValue(entry: IcfObject): string {
  const first = entry.fieldNames()[0];
  if (!first) return '';
  return entry.get(first)?.asText() ?? '';
}

/** Byte position of each `@record` block in source text (advisory, ICX §8). */
function scanRecordPositions(text: string): Array<{ line: number; offset: number; size: number }> {
  const lines = text.split('\n');
  const encoder = new TextEncoder();
  const starts: Array<{ line: number; offset: number }> = [];
  let byteOffset = 0;
  const lineByteOffsets: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    lineByteOffsets[i] = byteOffset;
    if (lines[i]!.startsWith('@record')) {
      starts.push({ line: i + 1, offset: byteOffset });
    }
    byteOffset += encoder.encode(lines[i]!).length + 1; // +1 for the '\n'
  }
  const totalBytes = byteOffset > 0 ? byteOffset - 1 : 0;
  return starts.map((s, i) => {
    const next = i + 1 < starts.length ? starts[i + 1]!.offset : totalBytes;
    return { line: s.line, offset: s.offset, size: Math.max(0, next - s.offset) };
  });
}
