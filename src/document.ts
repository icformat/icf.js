/**
 * A fully parsed (or built) ICF document, plus the record type.
 *
 * Mirrors icfj's `IcfDocument` / `IcfRecord`.
 */

import { IcfArray, IcfNode, IcfObject } from './model/node.js';
import { IcfMetadata } from './model/metadata.js';
import { IcfMasters } from './model/masters.js';
import { IcfSchema, IcfSchemas } from './model/schema.js';
import { resolveRecordData, resolveReference } from './resolver.js';

/** A single `@record` block: its attributes plus the record body. */
export class IcfRecord {
  constructor(
    private readonly attributes: Map<string, string>,
    private readonly data: IcfObject,
  ) {}

  /** Record body as a native object. */
  getData(): IcfObject {
    return this.data;
  }

  /** Attributes from the `@record` line, in declaration order. */
  getAttributes(): Map<string, string> {
    return new Map(this.attributes);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  getId(): string | null {
    return this.getAttribute('id');
  }
  getUuid(): string | null {
    return this.getAttribute('uuid');
  }
  getCreated(): string | null {
    return this.getAttribute('created');
  }
  getModified(): string | null {
    return this.getAttribute('modified');
  }
  getRevision(): string | null {
    return this.getAttribute('revision');
  }
  /** The `schema=` attribute — which `@schema id=...` this record uses. */
  getSchemaId(): string | null {
    return this.getAttribute('schema');
  }
  /** The `checksum=` attribute (spec v1.1 §38). */
  getChecksum(): string | null {
    return this.getAttribute('checksum');
  }
  /** Object names from the `primary=` attribute (spec v1.1 §39); `[]` when absent. */
  getPrimary(): string[] {
    const raw = this.getAttribute('primary');
    if (raw === null) return [];
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s !== '');
  }
}

export class IcfDocument {
  private readonly metadata: IcfMetadata;
  private readonly schemas: IcfSchemas;
  private readonly masters: IcfMasters;
  private readonly records: IcfRecord[];

  constructor(
    metadata: IcfMetadata,
    schemas: IcfSchema | IcfSchemas,
    masters: IcfMasters,
    records: IcfRecord[],
  ) {
    this.metadata = metadata;
    if (schemas instanceof IcfSchemas) {
      this.schemas = schemas;
    } else {
      const wrapped = new IcfSchemas();
      wrapped.add(IcfSchemas.DEFAULT_ID, schemas);
      this.schemas = wrapped;
    }
    this.masters = masters;
    this.records = records;
  }

  getMetadata(): IcfMetadata {
    return this.metadata;
  }

  /** The default schema (anonymous if present, else the first declared). */
  getSchema(): IcfSchema | null {
    return this.schemas.getDefault();
  }

  /** All schemas in the document, keyed by id (spec §7). */
  getSchemas(): IcfSchemas {
    return this.schemas;
  }

  getMasters(): IcfMasters {
    return this.masters;
  }

  hasMasters(): boolean {
    return !this.masters.isEmpty();
  }

  getRecords(): IcfRecord[] {
    return this.records;
  }

  getRecordCount(): number {
    return this.records.length;
  }

  getRecord(index: number): IcfRecord | null {
    return this.records[index] ?? null;
  }

  /**
   * Resolves a `Type:Id` reference (spec v1.1 §45 order): the record's
   * `primary=` objects first, then global masters. `record` may be `null`
   * for masters-only resolution.
   */
  resolveReference(record: IcfRecord | null, reference: string): IcfObject | null {
    return resolveReference(this, record, reference);
  }

  /**
   * A deep copy of a record's body with `!defaults` and `!overrides` applied
   * (processing model Phase 5). The parsed model is never mutated.
   */
  getResolvedRecordData(record: IcfRecord | number): IcfObject | null {
    const target = typeof record === 'number' ? this.getRecord(record) : record;
    if (!target) return null;
    return resolveRecordData(this, target);
  }

  /** One record → its object; otherwise an array of record objects. */
  toIcfNode(): IcfNode {
    if (this.records.length === 1) return this.records[0]!.getData();
    return this.getRecordsAsArray();
  }

  /** Always an array of record objects, regardless of record count. */
  getRecordsAsArray(): IcfArray {
    const arr = new IcfArray();
    for (const r of this.records) arr.add(r.getData());
    return arr;
  }

  toJsonString(): string {
    return this.toIcfNode().toJsonString();
  }

  toPrettyString(): string {
    return this.toIcfNode().toPrettyString();
  }
}
