import { describe, expect, it } from 'vitest';
import { parse, write } from '../src/index.js';
import { fixture, snapshot } from './helpers.js';

function roundTrips(name: string): void {
  const text = fixture(name);
  const first = parse(text);
  const out = write(first);
  const second = parse(out);
  expect(snapshot(second)).toEqual(snapshot(first));
}

describe('round-trip fixtures', () => {
  it('round-trips the invoice document semantically', () => {
    roundTrips('invoice.icf');
  });

  it('round-trips masters and escaped-whitespace attributes', () => {
    const doc = parse(fixture('invoice_with_masters.icf'));
    // master reference + escaped attribute survive
    expect(doc.getMasters().getTypes()).toEqual(['Vendor', 'Project']);
    expect(doc.getMasters().find('Vendor', 'VEN001')?.get('Name')?.asText()).toBe('ABC Traders');
    expect(doc.getRecord(0)?.getAttribute('note')).toBe('South Zone');
    roundTrips('invoice_with_masters.icf');
  });

  it('round-trips the multi-schema document', () => {
    const doc = parse(fixture('multi_schema.icf'));
    expect(doc.getSchemas().ids()).toEqual(['Masters', 'Invoice']);
    expect(doc.getRecord(0)?.getSchemaId()).toBe('Invoice');
    roundTrips('multi_schema.icf');
  });

  it('round-trips the full text-block fixture', () => {
    const doc = parse(fixture('textblock.icf'));
    const content = doc.getRecord(0)?.getData().path('OCRText').path('Content').asText();
    expect(content).toContain('@record');
    expect(content).toContain('Total: Rs. 84,500');
    roundTrips('textblock.icf');
  });
});
