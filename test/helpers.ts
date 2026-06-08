import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { IcfDocument } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));

export function fixture(name: string): string {
  return readFileSync(join(here, 'fixtures', name), 'utf8');
}

/** A semantic snapshot of a document: data, masters and record attributes. */
export function snapshot(doc: IcfDocument): unknown {
  const masters: Record<string, unknown> = {};
  for (const type of doc.getMasters().getTypes()) {
    masters[type] = JSON.parse(doc.getMasters().getType(type)!.toJsonString());
  }
  return {
    data: JSON.parse(doc.getRecordsAsArray().toJsonString()),
    masters,
    attributes: doc.getRecords().map((r) => Object.fromEntries(r.getAttributes())),
  };
}
