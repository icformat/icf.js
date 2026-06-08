/**
 * Derives an {@link IcfSchema} from a programmatically built {@link IcfNode}.
 *
 * Mirrors icfj's `SchemaInference`. Throws {@link IcfWriteError} on shapes ICF
 * cannot represent — e.g. an object mixing scalar fields with child
 * objects/arrays, or a mixed-type collection.
 */

import { IcfWriteError } from '../errors.js';
import { IcfNode } from '../model/node.js';
import { IcfSchema, SchemaNode } from '../model/schema.js';

export class SchemaInference {
  constructor(private readonly scalarArrayField: string) {}

  /** Infers a schema from a record root (object → one record; array → many). */
  infer(recordRoot: IcfNode): IcfSchema {
    const schema = new IcfSchema();
    const root = schema.getRoot();

    if (recordRoot.isArray()) {
      const elements = recordRoot.elements();
      if (elements.length === 0) return schema;
      const first = elements[0]!;
      if (!first.isObject()) {
        throw new IcfWriteError('Record array elements must be objects');
      }
      for (const [name, value] of first.fields()) {
        root.addChild(this.inferNode(name, value));
      }
      return schema;
    }

    if (recordRoot.isObject()) {
      for (const [name, value] of recordRoot.fields()) {
        root.addChild(this.inferNode(name, value));
      }
      return schema;
    }

    throw new IcfWriteError('Record root must be an object or array');
  }

  private inferNode(name: string, node: IcfNode): SchemaNode {
    if (node.isArray()) {
      const sn = new SchemaNode(name, true);
      const elements = node.elements();
      if (elements.length === 0) {
        sn.setFields([]);
        return sn;
      }
      const allObjects = elements.every((e) => e.isObject());
      const allScalars = elements.every((e) => e.isValue());

      if (allObjects) {
        for (const el of elements) {
          for (const [field, value] of el.fields()) {
            if (value.isContainer()) {
              throw new IcfWriteError(
                `Collection "${name}" element field "${field}" must be a scalar value`,
              );
            }
          }
        }
        sn.setFields(elements[0]!.fieldNames());
        return sn;
      }
      if (allScalars) {
        // scalar array — materialized via the synthesized single field
        sn.setFields([this.scalarArrayField]);
        return sn;
      }
      throw new IcfWriteError(`Collection "${name}" mixes object and scalar elements`);
    }

    if (node.isObject()) {
      const entries = node.fields();
      const hasContainer = entries.some(([, v]) => v.isContainer());
      const hasScalar = entries.some(([, v]) => v.isValue());

      if (!hasContainer) {
        // leaf object — scalar fields only
        const sn = new SchemaNode(name, false);
        sn.setFields(node.fieldNames());
        return sn;
      }
      if (!hasScalar) {
        // container — all children are objects/arrays
        const sn = new SchemaNode(name, false);
        for (const [childName, childValue] of entries) {
          sn.addChild(this.inferNode(childName, childValue));
        }
        return sn;
      }
      throw new IcfWriteError(
        `Object "${name}" mixes scalar fields with child objects/arrays (not representable in ICF)`,
      );
    }

    throw new IcfWriteError(`Cannot represent scalar node "${name}" at this position`);
  }
}
