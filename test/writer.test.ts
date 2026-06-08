import { afterEach, describe, expect, it } from 'vitest';
import {
  compute,
  canonicalContentBytes,
  generateIcx,
  generateIcxWithChecksums,
  parse,
  register,
  unregister,
  write,
  writeWithChecksum,
} from '../src/index.js';
import { fixture } from './helpers.js';

describe('writer & checksums', () => {
  afterEach(() => {
    unregister('md5');
  });

  it('default write emits no @checksum', () => {
    const out = write(parse(fixture('invoice.icf')));
    expect(out).not.toContain('@checksum');
  });

  it('writeWithChecksum value matches compute() over canonical bytes', async () => {
    const doc = parse(fixture('invoice.icf'));
    const out = await writeWithChecksum(doc);
    const expected = await compute('sha256', canonicalContentBytes(doc));
    expect(out).toContain(`@checksum ${expected}`);
  });

  it('replaces a stale stored @checksum exactly once', async () => {
    const doc = parse('@kind icf\n@checksum sha256:stale\n@schema\n\nX:\n  [a]\n\n@data\n\n@record\n\nX:\n  = 1\n');
    const out = await writeWithChecksum(doc);
    expect(out).not.toContain('sha256:stale');
    expect((out.match(/@checksum /g) ?? []).length).toBe(1);
  });

  it("an ICF's written @checksum equals its ICX @sourcechecksum", async () => {
    const doc = parse(fixture('invoice.icf'));
    const written = await writeWithChecksum(doc);
    const icx = await generateIcxWithChecksums(doc, { sourceFileName: 'invoice.icf' });
    const sourceChecksum = icx.getMetadata().getSourceChecksum();
    const checksumLine = written.split('\n').find((l) => l.startsWith('@checksum '))!;
    expect(checksumLine).toBe(`@checksum ${sourceChecksum}`);
  });

  it('generateIcx (structure only) leaves positional/checksum fields empty', () => {
    const icx = generateIcx(parse(fixture('multi_schema.icf')), 'multi_schema.icf');
    expect(icx.getMetadata().getKind()).toBe('icx');
    expect(icx.getMetadata().getSource()).toBe('multi_schema.icf');
    const invoice = icx.getRecord(0)!.getData().path('Invoice');
    expect(invoice.path(0).path('RecordID').asText()).toBe('INV001');
    expect(invoice.path(0).path('Checksum').asText()).toBe('');
  });

  it('computes per-record checksums and positions with source text', async () => {
    const text = fixture('multi_schema.icf');
    const icx = await generateIcxWithChecksums(parse(text), {
      sourceFileName: 'multi_schema.icf',
      sourceText: text,
    });
    const row = icx.getRecord(0)!.getData().path('Invoice').path(0);
    expect(row.path('Checksum').asText()).toMatch(/^sha256:[0-9a-f]+$/);
    expect(Number(row.path('Line').asText())).toBeGreaterThan(0);
  });

  it('leaves computed fields empty for an unsupported hash method', async () => {
    const text = '@kind icf\n@hashmethod md5\n@schema\n\nX:\n  [a]\n\n@data\n\n@record\n\nX:\n  = 1\n';
    const doc = parse(text);
    const icx = await generateIcxWithChecksums(doc, { sourceText: text });
    expect(icx.getMetadata().getHashMethod()).toBe('md5');
    expect(icx.getRecord(0)!.getData().path('X').path(0).path('Checksum').asText()).toBe('');
  });

  it('uses a registered provider for an otherwise-reserved method', async () => {
    register('md5', (data) => Uint8Array.from(data.slice(0, 4)));
    const text = '@kind icf\n@hashmethod md5\n@schema\n\nX:\n  [a]\n\n@data\n\n@record\n\nX:\n  = 1\n';
    const doc = parse(text);
    const icx = await generateIcxWithChecksums(doc, { sourceText: text });
    expect(icx.getRecord(0)!.getData().path('X').path(0).path('Checksum').asText()).toMatch(/^md5:/);
  });
});
