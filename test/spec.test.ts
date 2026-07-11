import { describe, expect, it } from 'vitest';
import { parse, parseLenient, validate, write, IcfParser } from '../src/index.js';

const HEADER = ['@kind icf', '@schema', '', 'Vendor:', '  [VendorID, Name, City]', '', '@data', ''].join('\n');

describe('spec compliance', () => {
  it('accepts both = and - row markers', () => {
    const eq = parse(HEADER + '\n@record\n\nVendor:\n  = V1, ABC, Pune\n');
    expect(eq.getRecord(0)!.getData().path('Vendor').path('Name').asText()).toBe('ABC');
    // a `-` marker on a single object is still accepted by the parser
    const dash = parse(HEADER + '\n@record\n\nVendor:\n  - V1, ABC, Pune\n');
    expect(dash.getRecord(0)!.getData().path('Vendor').path('Name').asText()).toBe('ABC');
  });

  it('supports compact object syntax', () => {
    const compact = parse(HEADER + '\n@record\n\nVendor:V1, ABC Traders, Coimbatore\n');
    const expanded = parse(HEADER + '\n@record\n\nVendor:\n  = V1, ABC Traders, Coimbatore\n');
    expect(compact.getRecord(0)!.getData().toJsonString()).toBe(
      expanded.getRecord(0)!.getData().toJsonString(),
    );
  });

  it('flags an unsupported higher major version as an error', () => {
    const result = validate('@kind icf\n@version 2.0\n@schema\n\nX:\n  [a]\n\n@data\n');
    expect(result.isValid()).toBe(false);
    expect(result.getErrors().some((m) => m.code === 'UNSUPPORTED_MAJOR_VERSION')).toBe(true);
  });

  it('warns (but continues) on a higher minor version', () => {
    const result = validate('@kind icf\n@version 1.5\n@schema\n\nX:\n  [a]\n\n@data\n');
    expect(result.isValid()).toBe(true);
    expect(result.getWarnings().some((m) => m.code === 'HIGHER_MINOR_VERSION')).toBe(true);
    expect(IcfParser.SUPPORTED_MAJOR_VERSION).toBe(1);
  });

  it('strips a leading UTF-8 BOM', () => {
    const doc = parse('﻿' + HEADER + '@record\n\nVendor:\n  = V1, ABC, Pune\n');
    expect(doc.getRecord(0)!.getData().path('Vendor').path('VendorID').asText()).toBe('V1');
  });

  it('emits @kind first and auto-computes @records', () => {
    const doc = parse(HEADER + '@record\n\nVendor:\n  = V1, ABC, Pune\n');
    const out = write(doc);
    expect(out.startsWith('@kind icf')).toBe(true);
    expect(out).toContain('@records 1');
  });

  it('reports a row on a container as an error but parses leniently', () => {
    const bad = '@kind icf\n@schema\n\nbox:\n\n  inner:\n    [a]\n\n@data\n\n@record\n\nbox:\n  = oops\n';
    expect(parseLenient(bad)).toBeDefined();
    expect(validate(bad).getErrors().some((m) => m.code === 'ROW_ON_CONTAINER')).toBe(true);
  });

  it('accepts a master record that references another master (foreign key)', () => {
    const icf = [
      '@kind icf',
      '@schema',
      '',
      'masters:',
      '  Vendor[]:',
      '    [VendorID, Name]',
      '  Project[]:',
      '    [ProjectID, Name, VendorRef]',
      '',
      '@masters',
      '',
      'Vendor:',
      '  - V001, ABC Developers',
      'Project:',
      '  - P001, XYZ Project, Vendor:V001',
      '',
      '@data',
      '',
    ].join('\n');
    const result = validate(icf);
    // a resolvable master-to-master reference is clean — no unresolved warning
    expect(result.getMessages().some((m) => m.code === 'UNRESOLVED_MASTER_REFERENCE')).toBe(false);
    const vendor = parse(icf).getMasters().resolveReference('Vendor:V001');
    expect(vendor?.get('Name')?.asText()).toBe('ABC Developers');
  });

  it('warns on a dangling master reference (in masters or data)', () => {
    const icf = [
      '@kind icf',
      '@schema',
      '',
      'masters:',
      '  Vendor[]:',
      '    [VendorID, Name]',
      '  Project[]:',
      '    [ProjectID, Name, VendorRef]',
      '',
      '@masters',
      '',
      'Vendor:',
      '  - V001, ABC Developers',
      'Project:',
      '  - P001, XYZ Project, Vendor:V999',
      '',
      '@data',
      '',
    ].join('\n');
    const result = validate(icf);
    const refWarn = result.getWarnings().find((m) => m.code === 'UNRESOLVED_MASTER_REFERENCE');
    expect(refWarn).toBeDefined();
    expect(refWarn!.message).toContain('Vendor:V999');
    // it's a warning, not an error — the document still parses
    expect(result.isValid()).toBe(true);
  });

  it('does not mistake plain colon-bearing values for master references', () => {
    // `Email`/time-like values whose prefix is not a declared master type must
    // not trigger UNRESOLVED_MASTER_REFERENCE.
    const icf = [
      '@kind icf',
      '@schema',
      '',
      'Vendor:',
      '  [VendorID, Email, Created]',
      '',
      '@data',
      '',
      '@record',
      '',
      'Vendor:',
      '  = V1, vendor@example.com, http://x.test/a',
      '',
    ].join('\n');
    expect(
      validate(icf).getMessages().some((m) => m.code === 'UNRESOLVED_MASTER_REFERENCE'),
    ).toBe(false);
  });

  it('resolves master types nested under a grouping node', () => {
    const icf = [
      '@kind icf',
      '@schema id=masterindextables',
      '',
      'masterindextables:',
      '  m0000002:',
      '    [masterindexvaluesid, masterid]',
      '  m0000001:',
      '    [masterindexvaluesid, masterid]',
      '',
      '@masters',
      '',
      'm0000002:',
      '  = 1, 10',
      'm0000001:',
      '  = 2, 5',
      '',
      '@data',
      '',
    ].join('\n');
    // The nested declaration is now recognised — no UNKNOWN_MASTER_TYPE warning.
    expect(validate(icf).getMessages().some((m) => m.code === 'UNKNOWN_MASTER_TYPE')).toBe(false);
    // …and the fields resolve from the nested node, so values map to names.
    const m2 = parse(icf).getMasters().getType('m0000002')!;
    expect(JSON.parse(m2.toJsonString())).toEqual([{ masterindexvaluesid: '1', masterid: '10' }]);
    // the writer mirrors the resolver, so it round-trips through write → parse.
    const round = parse(write(parse(icf)));
    expect(JSON.parse(round.getMasters().getType('m0000001')!.toJsonString())).toEqual([
      { masterindexvaluesid: '2', masterid: '5' },
    ]);
  });

  it('falls back to the shared index[] schema for ICX-style data', () => {
    const icx = [
      '@kind icx',
      '@schema',
      '',
      'index[]:',
      '  [RecordID, UUID, Line, Offset, Size, Checksum]',
      '',
      '@data',
      '',
      '@record',
      '',
      'Invoice:',
      '  - DOC1, , 10, 100, 50, sha256:abc',
    ].join('\n');
    const doc = parse(icx);
    const invoice = doc.getRecord(0)!.getData().path('Invoice');
    expect(invoice.isArray()).toBe(true);
    expect(invoice.path(0).path('RecordID').asText()).toBe('DOC1');
    expect(invoice.path(0).path('Checksum').asText()).toBe('sha256:abc');
  });
});
