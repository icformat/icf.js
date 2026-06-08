/**
 * The `@masters` section — a typed map of `Type → IcfArray<IcfObject>`.
 *
 * Mirrors icfj's `IcfMasters`. The **first field of each row is the primary
 * key**; {@link find} and {@link resolveReference} use it.
 */

import { IcfArray, IcfObject } from './node.js';

export class IcfMasters {
  /** The reserved schema container name for legacy-style masters. */
  static readonly MASTERS_NODE_NAME = 'masters';

  private readonly map = new Map<string, IcfArray>();

  isEmpty(): boolean {
    return this.map.size === 0;
  }

  typeCount(): number {
    return this.map.size;
  }

  totalEntryCount(): number {
    let total = 0;
    for (const arr of this.map.values()) total += arr.size;
    return total;
  }

  /** All declared type names, in declaration order. */
  getTypes(): string[] {
    return [...this.map.keys()];
  }

  hasType(typeName: string): boolean {
    return this.map.has(typeName);
  }

  /** All entries for a type, or `null`. */
  getType(typeName: string): IcfArray | null {
    return this.map.get(typeName) ?? null;
  }

  /** Ordered `type → entries` map. */
  asMap(): Map<string, IcfArray> {
    return new Map(this.map);
  }

  /** Returns the entry array for a type, creating it if absent. */
  putType(typeName: string): IcfArray {
    let arr = this.map.get(typeName);
    if (!arr) {
      arr = new IcfArray();
      this.map.set(typeName, arr);
    }
    return arr;
  }

  /** Appends a fresh empty entry to a type and returns it for population. */
  addEntry(typeName: string): IcfObject {
    return this.putType(typeName).addObject();
  }

  /** Looks up an entry by the value of its first field (the primary key). */
  find(typeName: string, primaryKey: string): IcfObject | null {
    const arr = this.map.get(typeName);
    if (!arr) return null;
    for (const el of arr.elements()) {
      if (!el.isObject()) continue;
      const names = el.fieldNames();
      if (names.length === 0) continue;
      const first = el.get(names[0]!);
      if (first && first.asText() === primaryKey) return el;
    }
    return null;
  }

  /** Parses `"Type:Id"` and returns the matching entry, or `null`. */
  resolveReference(reference: string): IcfObject | null {
    const idx = reference.indexOf(':');
    if (idx < 0) return null;
    const typeName = reference.slice(0, idx);
    const primaryKey = reference.slice(idx + 1);
    return this.find(typeName, primaryKey);
  }
}
