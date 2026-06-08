/**
 * The native ICF data tree — a JSON-tree-style DOM with five node kinds.
 *
 * Mirrors icfj's `org.icformat.icfj.model.IcfNode` and its subclasses, in
 * camelCase. `path(...)` returns {@link IcfMissing} (never `null`) so lookup
 * chains cannot throw.
 */

/** The five node kinds. */
export enum NodeType {
  OBJECT = 'OBJECT',
  ARRAY = 'ARRAY',
  STRING = 'STRING',
  NULL = 'NULL',
  MISSING = 'MISSING',
}

/** Value accepted by the builder helpers; normalized to an {@link IcfNode}. */
export type IcfValue = string | number | boolean | null | IcfNode;

/** JSON shape produced by {@link IcfNode.toJSON}. */
export type IcfJson = null | string | IcfJson[] | { [key: string]: IcfJson };

/** Abstract base for the five node kinds. */
export abstract class IcfNode {
  abstract get type(): NodeType;

  // ---- type checks ------------------------------------------------------

  isObject(): this is IcfObject {
    return this.type === NodeType.OBJECT;
  }
  isArray(): this is IcfArray {
    return this.type === NodeType.ARRAY;
  }
  isString(): this is IcfString {
    return this.type === NodeType.STRING;
  }
  isNull(): boolean {
    return this.type === NodeType.NULL;
  }
  isMissing(): boolean {
    return this.type === NodeType.MISSING;
  }
  /** True for objects and arrays. */
  isContainer(): boolean {
    return this.isObject() || this.isArray();
  }
  /** True for strings, nulls and the missing sentinel. */
  isValue(): boolean {
    return !this.isContainer();
  }

  // ---- navigation -------------------------------------------------------

  /** Field of an object / element of an array, or `null` when absent. */
  get(_key: string | number): IcfNode | null {
    return null;
  }

  /** Like {@link get} but returns {@link IcfMissing} instead of `null`. */
  path(key: string | number): IcfNode {
    const found = this.get(key);
    return found ?? MISSING;
  }

  has(_key: string | number): boolean {
    return false;
  }

  /** Field count (object) or element count (array). */
  get size(): number {
    return 0;
  }

  /** Alias of {@link size} that reads naturally on arrays. */
  get length(): number {
    return this.size;
  }

  isEmpty(): boolean {
    return this.size === 0;
  }

  /** Object field names in insertion order; `[]` for non-objects. */
  fieldNames(): string[] {
    return [];
  }

  /** Ordered `name → node` entries; empty for non-objects. */
  fields(): Array<[string, IcfNode]> {
    return [];
  }

  /** Ordered elements; empty for non-arrays. */
  elements(): IcfNode[] {
    return [];
  }

  // ---- value access -----------------------------------------------------

  /** Raw string for {@link IcfString}; `null` for every other kind. */
  get textValue(): string | null {
    return null;
  }

  /** Best-effort text: the value for strings, the default otherwise. */
  asText(defaultValue = ''): string {
    return defaultValue;
  }

  // ---- serialization ----------------------------------------------------

  /** Compact JSON. */
  toJsonString(): string {
    return JSON.stringify(this.toJSON());
  }

  /** Indented JSON (2 spaces). */
  toPrettyString(): string {
    return JSON.stringify(this.toJSON(), null, 2);
  }

  abstract toJSON(): IcfJson;

  toString(): string {
    return this.toJsonString();
  }

  // ---- factories --------------------------------------------------------

  static object(): IcfObject {
    return new IcfObject();
  }
  static array(): IcfArray {
    return new IcfArray();
  }
  static text(value: string): IcfString {
    return new IcfString(value);
  }
  static nullNode(): IcfNull {
    return NULL;
  }
  static missing(): IcfMissing {
    return MISSING;
  }
  /** `null` → {@link IcfNull}; otherwise an {@link IcfString}. */
  static of(value: string | null): IcfNode {
    return value === null ? NULL : new IcfString(value);
  }
}

/** Normalizes a loose value into an {@link IcfNode}. */
export function toNode(value: IcfValue): IcfNode {
  if (value === null) return NULL;
  if (value instanceof IcfNode) return value;
  if (typeof value === 'string') return new IcfString(value);
  // numbers and booleans are stored as text (ICF v1 is untyped)
  return new IcfString(String(value));
}

/** An ordered map of named child nodes. */
export class IcfObject extends IcfNode {
  private readonly map = new Map<string, IcfNode>();

  override get type(): NodeType {
    return NodeType.OBJECT;
  }

  override get(key: string | number): IcfNode | null {
    return this.map.get(String(key)) ?? null;
  }

  override has(key: string | number): boolean {
    return this.map.has(String(key));
  }

  override get size(): number {
    return this.map.size;
  }

  override fieldNames(): string[] {
    return [...this.map.keys()];
  }

  override fields(): Array<[string, IcfNode]> {
    return [...this.map.entries()];
  }

  override toJSON(): IcfJson {
    const out: { [key: string]: IcfJson } = {};
    for (const [k, v] of this.map) out[k] = v.toJSON();
    return out;
  }

  // ---- builders ---------------------------------------------------------

  /** Sets a field; `null` is stored as {@link IcfNull}. Returns `this`. */
  set(name: string, value: IcfValue): this {
    this.map.set(name, toNode(value));
    return this;
  }

  /** Alias of {@link set}. Accepts scalars or nodes. Returns `this`. */
  put(name: string, value: IcfValue): this {
    return this.set(name, value);
  }

  /** Stores an explicit `null`. Returns `this`. */
  putNull(name: string): this {
    this.map.set(name, NULL);
    return this;
  }

  /** Adds a fresh child object and returns *it* for further building. */
  putObject(name: string): IcfObject {
    const child = new IcfObject();
    this.map.set(name, child);
    return child;
  }

  /** Adds a fresh child array and returns *it* for further building. */
  putArray(name: string): IcfArray {
    const child = new IcfArray();
    this.map.set(name, child);
    return child;
  }

  /** Removes a field, returning the removed node (or `null`). */
  remove(name: string): IcfNode | null {
    const existing = this.map.get(name) ?? null;
    this.map.delete(name);
    return existing;
  }
}

/** An ordered list of child nodes. */
export class IcfArray extends IcfNode {
  private readonly list: IcfNode[] = [];

  override get type(): NodeType {
    return NodeType.ARRAY;
  }

  override get(key: string | number): IcfNode | null {
    const i = typeof key === 'number' ? key : Number(key);
    return this.list[i] ?? null;
  }

  override has(key: string | number): boolean {
    const i = typeof key === 'number' ? key : Number(key);
    return i >= 0 && i < this.list.length;
  }

  override get size(): number {
    return this.list.length;
  }

  override elements(): IcfNode[] {
    return [...this.list];
  }

  override toJSON(): IcfJson {
    return this.list.map((n) => n.toJSON());
  }

  // ---- builders ---------------------------------------------------------

  /** Appends a value; `null` becomes {@link IcfNull}. Returns `this`. */
  add(value: IcfValue): this {
    this.list.push(toNode(value));
    return this;
  }

  /** Appends an explicit `null`. Returns `this`. */
  addNull(): this {
    this.list.push(NULL);
    return this;
  }

  /** Appends a fresh object and returns *it*. */
  addObject(): IcfObject {
    const child = new IcfObject();
    this.list.push(child);
    return child;
  }

  /** Appends a fresh array and returns *it*. */
  addArray(): IcfArray {
    const child = new IcfArray();
    this.list.push(child);
    return child;
  }
}

/** A scalar text value (the empty string is allowed and distinct from null). */
export class IcfString extends IcfNode {
  constructor(private readonly value: string) {
    super();
  }

  override get type(): NodeType {
    return NodeType.STRING;
  }

  override get textValue(): string {
    return this.value;
  }

  override asText(_defaultValue = ''): string {
    return this.value;
  }

  override toJSON(): IcfJson {
    return this.value;
  }
}

/** An explicit `null` literal — distinct from an empty string. Singleton. */
export class IcfNull extends IcfNode {
  override get type(): NodeType {
    return NodeType.NULL;
  }
  override toJSON(): IcfJson {
    return null;
  }
}

/** Sentinel returned by {@link IcfNode.path} for absent lookups. Singleton. */
export class IcfMissing extends IcfNode {
  override get type(): NodeType {
    return NodeType.MISSING;
  }
  override toJSON(): IcfJson {
    return null;
  }
}

/** The shared explicit-null singleton. */
export const NULL = new IcfNull();

/** The shared missing-sentinel singleton. */
export const MISSING = new IcfMissing();
