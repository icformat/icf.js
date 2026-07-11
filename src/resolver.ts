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
import { IcfSchema, SchemaNode } from './model/schema.js';
import type { IcfDocument, IcfRecord } from './document.js';

/**
 * A value shaped like a `Type:Id` reference (spec v1.1 §44): an identifier
 * (per the EBNF: letters, digits, `_`, `-`, `.`), a colon, then a
 * whitespace-free id. Shared by the parser's referential-integrity scan and
 * the ICX generator's tag harvesting.
 */
export const REFERENCE_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]*:\S+$/;

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

/**
 * Clones a schema for **resolved export** (ICX v1.2 companion feature):
 * every node's field list is extended with `!defaults` keys not already
 * declared (declared fields first, then extras in declaration order), and
 * **all annotations are dropped** — in a resolved document the defaults and
 * overrides are baked into the rows, so the annotations no longer apply.
 * The input schema is never mutated.
 */
export function resolveSchemaForExport(
  schema: IcfSchema,
  extraKeys?: Map<SchemaNode, Set<string>>,
): IcfSchema {
  const out = new IcfSchema();
  for (const child of schema.getTopLevelNodes().values()) {
    out.getRoot().addChild(cloneNodeForExport(child, extraKeys));
  }
  return out;
}

function cloneNodeForExport(node: SchemaNode, extraKeys?: Map<SchemaNode, Set<string>>): SchemaNode {
  const clone = new SchemaNode(node.name, node.isCollection());
  const fields = [...node.getFields()];
  for (const key of node.getDefaults().keys()) {
    if (!fields.includes(key)) fields.push(key);
  }
  for (const key of extraKeys?.get(node) ?? []) {
    if (!fields.includes(key)) fields.push(key);
  }
  clone.setFields(fields);
  for (const child of node.getChildren().values()) {
    clone.addChild(cloneNodeForExport(child, extraKeys));
  }
  return clone;
}

/**
 * Records a row's `!overrides` keys that are not declared fields of its
 * schema node into `extras` — a resolved export must widen the field list
 * so those values survive serialization (the spec's own §47 example
 * overrides a key foreign to the row's object).
 */
export function addOverrideKeys(
  extras: Map<SchemaNode, Set<string>>,
  node: SchemaNode,
  row: IcfObject,
): void {
  for (const key of row.getOverrides().keys()) {
    if (node.getFields().includes(key)) continue;
    let set = extras.get(node);
    if (!set) {
      set = new Set();
      extras.set(node, set);
    }
    set.add(key);
  }
}

/**
 * Resolves a single leaf row for export: values copied, `!defaults` of the
 * schema node filled for absent fields, `!overrides` applied; the returned
 * row carries no annotations.
 */
export function resolveLeafRow(row: IcfObject, schemaNode: SchemaNode | null): IcfObject {
  return cloneResolved(row, schemaNode && schemaNode.isLeaf() ? schemaNode : null) as IcfObject;
}

/**
 * Collects, per schema node, the row `!overrides` keys observed in a
 * document's records that are not declared fields.
 */
export function collectOverrideKeys(document: IcfDocument): Map<SchemaNode, Set<string>> {
  const extras = new Map<SchemaNode, Set<string>>();
  const note = (node: SchemaNode, row: IcfObject): void => addOverrideKeys(extras, node, row);
  const walk = (data: IcfNode, node: SchemaNode | null): void => {
    if (!node) return;
    if (data.isArray()) {
      for (const el of data.elements()) walk(el, node);
      return;
    }
    if (!data.isObject()) return;
    if (node.isLeaf()) {
      note(node, data);
      return;
    }
    for (const [name, value] of data.fields()) {
      walk(value, node.getChild(name) ?? null);
    }
  };
  for (const record of document.getRecords()) {
    const schema = document.getSchemas().get(record.getSchemaId()) ?? document.getSchemas().getDefault();
    if (!schema) continue;
    for (const [name, value] of record.getData().fields()) {
      walk(value, schema.getRoot().getChild(name) ?? null);
    }
  }
  return extras;
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
