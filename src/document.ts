/**
 * A fully parsed (or built) ICF document, plus the record type.
 *
 * Mirrors icfj's `IcfDocument` / `IcfRecord`.
 */

import { IcfArray, IcfNode, IcfObject } from './model/node.js';
import { IcfMetadata } from './model/metadata.js';
import { IcfMasters } from './model/masters.js';
import { IcfSchema, IcfSchemas } from './model/schema.js';

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
