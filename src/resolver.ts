/**
 * Reference resolution and record resolution (spec v1.1 §39, §45, §47 and
 * the Normative Processing Model Phase 5).
 *
 * Parsing keeps rows exactly as written (round-trip fidelity). These helpers
 * produce the *resolved* view: schema `!defaults` fill absent fields, row
 * `!overrides` then replace/add values, and `Type:Id` references resolve
 * record-local primary objects before global masters.
 */

import { IcfArray, IcfNode, IcfObject, IcfString } from './model/node.js';
import { SchemaNode } from './model/schema.js';
import type { IcfDocument, IcfRecord } from './document.js';

/**
 * Resolves a `Type:Id` reference for a record (spec §45 order): the record's
 * `primary=` objects first, then the global `@masters` section. Returns the
 * referenced row object, or `null`. Pass `record = null` for masters-only
 * resolution.
 */
export function resolveReference(
  document: IcfDocument,
  record: IcfRecord | null,
  reference: string,
): IcfObject | null {
  const idx = reference.indexOf(':');
  if (idx <= 0) return null;
  const type = reference.slice(0, idx);
  const id = reference.slice(idx + 1);
  if (record && record.getPrimary().includes(type)) {
    const local = findPrimaryObject(record.getData(), type, id);
    if (local) return local;
  }
  return document.getMasters().resolveReference(reference);
}

/**
 * Finds a record-local primary object: the object/collection named `name`
 * anywhere in the record body whose row's **first field** equals `id`
 * (the same primary-key rule the masters use).
 */
export function findPrimaryObject(data: IcfObject, name: string, id: string): IcfObject | null {
  for (const [key, value] of data.fields()) {
    if (key === name) {
      if (value.isArray()) {
        for (const el of value.elements()) {
          if (el.isObject() && firstFieldEquals(el, id)) return el;
        }
      } else if (value.isObject() && firstFieldEquals(value, id)) {
        return value;
      }
    }
    if (value.isObject()) {
      const deeper = findPrimaryObject(value, name, id);
      if (deeper) return deeper;
    }
  }
  return null;
}

function firstFieldEquals(row: IcfObject, id: string): boolean {
  const first = row.fields()[0]?.[1];
  return first !== undefined && first.asText() === id;
}

/**
 * Returns a **deep copy** of the record body with Phase-5 resolution applied:
 * for every row, the owning schema object's `!defaults` supply values for
 * fields absent from the row, then the row's `!overrides` replace/add values.
 * Empty strings and `null` literals are *present* values — defaults never
 * replace them. Row annotations are not carried into the resolved copy.
 */
export function resolveRecordData(document: IcfDocument, record: IcfRecord): IcfObject {
  const schema = document.getSchemas().get(record.getSchemaId()) ?? document.getSchemas().getDefault();
  const resolved = cloneResolved(record.getData(), schema?.getRoot() ?? null);
  return resolved as IcfObject;
}

function cloneResolved(node: IcfNode, schemaNode: SchemaNode | null): IcfNode {
  if (node.isArray()) {
    const out = new IcfArray();
    for (const el of (node as IcfArray).elements()) out.add(cloneResolved(el, schemaNode));
    return out;
  }
  if (!node.isObject()) return node; // strings / null are immutable — share
  const obj = node as IcfObject;
  const isContainer = schemaNode !== null && !schemaNode.isLeaf();
  const out = new IcfObject();

  if (isContainer) {
    for (const [name, value] of obj.fields()) {
      out.set(name, cloneResolved(value, schemaNode.getChild(name) ?? null));
    }
    return out;
  }

  // leaf row: copy values, fill defaults, apply overrides
  for (const [name, value] of obj.fields()) out.set(name, cloneResolved(value, null));
  if (schemaNode) {
    for (const [field, value] of schemaNode.getDefaults()) {
      if (!out.has(field)) out.set(field, new IcfString(value));
    }
  }
  for (const [field, value] of obj.getOverrides()) {
    out.set(field, new IcfString(value));
  }
  return out;
}
