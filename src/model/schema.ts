/**
 * The schema DOM — mirrors icfj's `SchemaNode`, `IcfSchema`, `IcfSchemas`.
 *
 * A {@link SchemaNode} is either a **container** (has children → nested
 * object), a **leaf object** (scalar fields → one `=` row), or a **leaf
 * collection** (`Name[]:` → zero-or-more rows → array).
 */

/** One node in a schema tree. */
export class SchemaNode {
  name: string;
  collection: boolean;
  /** Declared field names, in order (scalar fields, or child names on a container). */
  fields: string[] = [];
  private readonly childMap = new Map<string, SchemaNode>();

  constructor(name = '', collection = false) {
    this.name = name;
    this.collection = collection;
  }

  /** True when this node has no children (a leaf). */
  isLeaf(): boolean {
    return this.childMap.size === 0;
  }

  isCollection(): boolean {
    return this.collection;
  }

  setCollection(value: boolean): void {
    this.collection = value;
  }

  getFields(): string[] {
    return this.fields;
  }

  setFields(fields: string[]): void {
    this.fields = fields;
  }

  /** Ordered `name → child` map (live view). */
  getChildren(): Map<string, SchemaNode> {
    return this.childMap;
  }

  getChild(name: string): SchemaNode | undefined {
    return this.childMap.get(name);
  }

  hasChild(name: string): boolean {
    return this.childMap.has(name);
  }

  addChild(child: SchemaNode): void {
    this.childMap.set(child.name, child);
  }
}

/** A single schema tree (the body of one `@schema` block). */
export class IcfSchema {
  private readonly rootNode = new SchemaNode('');

  /** Synthetic unnamed root whose children are the top-level declared nodes. */
  getRoot(): SchemaNode {
    return this.rootNode;
  }

  /** Ordered `name → node` map of top-level declarations. */
  getTopLevelNodes(): Map<string, SchemaNode> {
    return this.rootNode.getChildren();
  }

  getTopLevelNode(name: string): SchemaNode | undefined {
    return this.rootNode.getChild(name);
  }

  isEmpty(): boolean {
    return this.rootNode.isLeaf();
  }
}

/** A keyed collection of {@link IcfSchema} — one per `@schema id=...` block. */
export class IcfSchemas {
  /** The id of an `@schema` declared without `id=`. */
  static readonly DEFAULT_ID = '';

  private readonly map = new Map<string, IcfSchema>();
  private firstId: string | null = null;

  isEmpty(): boolean {
    return this.map.size === 0;
  }

  get size(): number {
    return this.map.size;
  }

  /** All schema ids, in declaration order. */
  ids(): string[] {
    return [...this.map.keys()];
  }

  has(id: string): boolean {
    return this.map.has(id);
  }

  /** Schema for `id`, or `null`. A nullish id maps to {@link DEFAULT_ID}. */
  get(id: string | null | undefined): IcfSchema | null {
    return this.map.get(id ?? IcfSchemas.DEFAULT_ID) ?? null;
  }

  /** The anonymous schema if present, else the first declared; `null` if empty. */
  getDefault(): IcfSchema | null {
    if (this.map.has(IcfSchemas.DEFAULT_ID)) {
      return this.map.get(IcfSchemas.DEFAULT_ID)!;
    }
    return this.firstId !== null ? this.map.get(this.firstId)! : null;
  }

  /** Ordered `id → schema` map. */
  asMap(): Map<string, IcfSchema> {
    return new Map(this.map);
  }

  /** Stores `schema` under `id`, returning the stored schema. */
  add(id: string, schema: IcfSchema): IcfSchema {
    if (this.firstId === null) this.firstId = id;
    this.map.set(id, schema);
    return schema;
  }

  /** Returns the schema for `id`, creating an empty one if absent. */
  getOrCreate(id: string): IcfSchema {
    let schema = this.map.get(id);
    if (!schema) {
      schema = new IcfSchema();
      this.add(id, schema);
    }
    return schema;
  }
}
