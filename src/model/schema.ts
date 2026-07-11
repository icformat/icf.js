/**
 * The schema DOM — mirrors icfj's `SchemaNode`, `IcfSchema`, `IcfSchemas`.
 *
 * A {@link SchemaNode} is either a **container** (has children → nested
 * object), a **leaf object** (scalar fields → one `=` row), or a **leaf
 * collection** (`Name[]:` → zero-or-more rows → array).
 */

/** Standard schema annotation names (spec v1.1 §26). */
export const STANDARD_SCHEMA_ANNOTATIONS = ['indexes', 'defaults', 'constraints', 'expressions'] as const;

/** One node in a schema tree. */
export class SchemaNode {
  name: string;
  collection: boolean;
  /** Declared field names, in order (scalar fields, or child names on a container). */
  fields: string[] = [];
  private readonly childMap = new Map<string, SchemaNode>();
  /** `!annotation` entries (spec v1.1 §25), lazily created. */
  private annotationMap: Map<string, string[]> | null = null;

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

  // ---- schema annotations (spec v1.1 §25–§31) ----------------------------

  hasAnnotations(): boolean {
    return this.annotationMap !== null && this.annotationMap.size > 0;
  }

  /** Ordered `annotationName → entries` map (live view; created on demand). */
  getAnnotations(): Map<string, string[]> {
    if (this.annotationMap === null) this.annotationMap = new Map();
    return this.annotationMap;
  }

  /** Entries of one annotation, or `[]` when absent. */
  getAnnotation(name: string): string[] {
    return this.annotationMap?.get(name) ?? [];
  }

  /** Appends entries to an annotation (same name merges — spec §25). */
  addAnnotationEntries(name: string, entries: string[]): void {
    const map = this.getAnnotations();
    const existing = map.get(name);
    if (existing) existing.push(...entries);
    else map.set(name, [...entries]);
  }

  /** `!indexes` entries, e.g. `["empid", "department+empid"]` (spec §27). */
  getIndexes(): string[] {
    return [...this.getAnnotation('indexes')];
  }

  /** `!defaults` parsed as `field → value` from `k=v` entries (spec §28). */
  getDefaults(): Map<string, string> {
    return parseAssignments(this.getAnnotation('defaults'));
  }

  /** `!constraints` parsed as `field → keywords` from `field:kw` entries (spec §29). */
  getConstraints(): Map<string, string[]> {
    const out = new Map<string, string[]>();
    for (const entry of this.getAnnotation('constraints')) {
      const idx = entry.indexOf(':');
      if (idx <= 0) continue; // malformed — reported by the parser, preserved raw
      const field = entry.slice(0, idx).trim();
      const keyword = entry.slice(idx + 1).trim();
      const list = out.get(field);
      if (list) list.push(keyword);
      else out.set(field, [keyword]);
    }
    return out;
  }

  /** `!expressions` parsed as `field → expression` from `k=expr` entries (spec §30). */
  getExpressions(): Map<string, string> {
    return parseAssignments(this.getAnnotation('expressions'));
  }
}

/** Parses `key=value` entries into an ordered map (first `=` splits). */
function parseAssignments(entries: string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const entry of entries) {
    const idx = entry.indexOf('=');
    if (idx <= 0) continue; // malformed — reported by the parser, preserved raw
    out.set(entry.slice(0, idx).trim(), entry.slice(idx + 1).trim());
  }
  return out;
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
