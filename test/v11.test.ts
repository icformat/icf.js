import { describe, expect, it } from 'vitest';
import { parse, parseLenient, validate, write } from '../src/index.js';
import { fixture } from './helpers.js';

const V11 = fixture('employee_v11.icf');

/** A minimal valid header for hand-built documents. */
function doc(body: string): string {
  return `@kind icf\n@version 1.1\n${body}`;
}

describe('ICF v1.1', () => {
  // ---- version gate --------------------------------------------------------

  it('accepts @version 1.1 silently, warns at 1.2, errors at 2.0', () => {
    const body = '@schema\n\nX:\n  [a]\n\n@data\n';
    expect(validate(`@kind icf\n@version 1.1\n${body}`).getWarnings().some((m) => m.code === 'HIGHER_MINOR_VERSION')).toBe(false);
    expect(validate(`@kind icf\n@version 1.0\n${body}`).getWarnings().some((m) => m.code === 'HIGHER_MINOR_VERSION')).toBe(false);
    expect(validate(`@kind icf\n@version 1.2\n${body}`).getWarnings().some((m) => m.code === 'HIGHER_MINOR_VERSION')).toBe(true);
    expect(validate(`@kind icf\n@version 2.0\n${body}`).getErrors().some((m) => m.code === 'UNSUPPORTED_MAJOR_VERSION')).toBe(true);
  });

  // ---- kitchen-sink fixture ------------------------------------------------

  it('parses the v1.1 kitchen-sink fixture without errors', () => {
    const result = validate(V11);
    expect(result.getErrors()).toEqual([]);
    expect(result.isValid()).toBe(true);
  });

  it('parses all four standard schema annotations', () => {
    const document = parse(V11);
    const employee = document.getSchemas().get('Employee')!.getTopLevelNode('employee')!;
    expect(employee.getIndexes()).toEqual(['empid']);
    expect(employee.getDefaults().get('empstatus')).toBe('employed');
    expect(employee.getDefaults().get('idstatus')).toBe('issued');
    expect(employee.getConstraints().get('empid')).toEqual(['unique']);
    expect(employee.getConstraints().get('empemail')).toEqual(['required']);
    const salary = document.getSchemas().get('Employee')!.getTopLevelNode('salary')!;
    expect(salary.getExpressions().get('total')).toBe('amount+amount*0.25');
  });

  it('parses multiline value rows (spec §59)', () => {
    const document = parse(V11);
    const emp = document.getRecord(0)!.getData().path('employee');
    expect(emp.path('empname').asText()).toBe('Anand');
    expect(emp.path('empemail').asText()).toBe('anand@example.com');
    // the Project master row is also written across three lines
    const project = document.getMasters().find('Project', 'PRJ001')!;
    expect(project.get('Location')!.asText()).toBe('Coimbatore');
    expect(project.get('VendorRef')!.asText()).toBe('Vendor:VEN001');
  });

  it('attaches !overrides to the immediately preceding row only', () => {
    const document = parse(V11);
    const salary = document.getRecord(0)!.getData().path('salary');
    const row1 = salary.path(0);
    const row2 = salary.path(1);
    expect(row1.isObject() && row1.getOverrides().get('idstatus')).toBe('tobeissued');
    expect(row2.isObject() && row2.hasRowAnnotations()).toBe(false);
  });

  it('resolves references primary-first, then masters (spec §45)', () => {
    const document = parse(V11);
    const record = document.getRecord(0)!;
    // record-local primary object
    const desig = document.resolveReference(record, 'designation:MGR01');
    expect(desig?.get('designame')?.asText()).toBe('Manager');
    // global master (FK from another master row)
    const vendor = document.resolveReference(record, 'Vendor:VEN001');
    expect(vendor?.get('Name')?.asText()).toBe('ABC Traders');
    // no unresolved warnings in the fixture
    const codes = validate(V11).getMessages().map((m) => m.code);
    expect(codes).not.toContain('UNRESOLVED_PRIMARY_REFERENCE');
    expect(codes).not.toContain('UNRESOLVED_MASTER_REFERENCE');
  });

  it('round-trips annotations, overrides and primary through write → parse', () => {
    const first = parse(V11);
    const second = parse(write(first));
    // data model identical
    expect(second.getRecordsAsArray().toJsonString()).toBe(first.getRecordsAsArray().toJsonString());
    // record attributes (incl. primary=) preserved
    expect(second.getRecord(0)!.getPrimary()).toEqual(['designation']);
    // schema annotations preserved
    const employee = second.getSchemas().get('Employee')!.getTopLevelNode('employee')!;
    expect(employee.getDefaults().get('empstatus')).toBe('employed');
    expect(employee.getConstraints().get('empid')).toEqual(['unique']);
    expect(employee.getIndexes()).toEqual(['empid']);
    // row annotations preserved
    const row1 = second.getRecord(0)!.getData().path('salary').path(0);
    expect(row1.isObject() && row1.getOverrides().get('idstatus')).toBe('tobeissued');
    // masters preserved
    expect(second.getMasters().resolveReference('Project:PRJ001')?.get('VendorRef')?.asText()).toBe('Vendor:VEN001');
  });

  // ---- defaults + overrides resolution --------------------------------------

  it('resolves defaults and overrides without mutating the raw model', () => {
    const document = parse(V11);
    const record = document.getRecord(0)!;
    const raw = record.getData();
    const resolved = document.getResolvedRecordData(record)!;

    // raw rows carry only what was written
    expect(raw.path('employee').has('empstatus')).toBe(false);
    // resolved rows gain the defaults…
    expect(resolved.path('employee').path('empstatus').asText()).toBe('employed');
    expect(resolved.path('employee').path('idstatus').asText()).toBe('issued');
    // …and the override replaces the value on its row only
    expect(resolved.path('salary').path(0).path('idstatus').asText()).toBe('tobeissued');
    expect(resolved.path('salary').path(1).has('idstatus')).toBe(false); // salary declares no defaults
    // raw model untouched
    expect(raw.path('employee').has('empstatus')).toBe(false);
    expect(raw.path('salary').path(0).has('idstatus')).toBe(false);
  });

  it('defaults never replace present values (empty string is present)', () => {
    const text = doc(
      [
        '@schema',
        '',
        'X:',
        '  [a, b]',
        '  !defaults:',
        '    = b=fallback, c=extra',
        '',
        '@data',
        '',
        '@record',
        '',
        'X:',
        '  = 1, ',
        '',
      ].join('\n'),
    );
    const document = parseLenient(text);
    const resolved = document.getResolvedRecordData(0)!;
    expect(resolved.path('X').path('b').asText()).toBe(''); // written empty — not defaulted
    expect(resolved.path('X').path('c').asText()).toBe('extra'); // absent — defaulted
  });

  // ---- primary objects -------------------------------------------------------

  it('warns UNRESOLVED_PRIMARY_REFERENCE for a dangling primary reference', () => {
    const text = doc(
      [
        '@schema',
        '',
        'employee:',
        '  [empid, empname]',
        'salary[]:',
        '  [empref, amount]',
        '',
        '@data',
        '',
        '@record primary=employee',
        '',
        'employee:',
        '  = 1, Anand',
        '',
        'salary:',
        '  - employee:99, 1000',
        '',
      ].join('\n'),
    );
    const result = validate(text);
    const warning = result.getWarnings().find((m) => m.code === 'UNRESOLVED_PRIMARY_REFERENCE');
    expect(warning).toBeDefined();
    expect(warning!.message).toContain('employee:99');
    expect(result.isValid()).toBe(true);
  });

  it('warns PRIMARY_OBJECT_NOT_FOUND when primary= names a missing object', () => {
    const text = doc(
      ['@schema', '', 'X:', '  [a]', '', '@data', '', '@record primary=ghost', '', 'X:', '  = 1', ''].join('\n'),
    );
    expect(validate(text).getWarnings().some((m) => m.code === 'PRIMARY_OBJECT_NOT_FOUND')).toBe(true);
  });

  // ---- constraints -----------------------------------------------------------

  it('validates required and unique constraints as warnings', () => {
    const text = doc(
      [
        '@schema',
        '',
        'person[]:',
        '  [pid, email]',
        '  !constraints:',
        '    = pid:unique, email:required, pid:frobnicate',
        '',
        '@data',
        '',
        '@record',
        '',
        'person:',
        '  - P1, a@x.test',
        '  - P1, ',
        '',
      ].join('\n'),
    );
    const result = validate(text);
    const codes = result.getWarnings().map((m) => m.code);
    expect(codes).toContain('UNIQUE_CONSTRAINT_VIOLATION');
    expect(codes).toContain('REQUIRED_FIELD_MISSING');
    expect(codes).toContain('UNKNOWN_CONSTRAINT');
    expect(result.isValid()).toBe(true); // constraints never invalidate
  });

  // ---- reserved names ---------------------------------------------------------

  it('warns on reserved directive names as object names in every document kind', () => {
    const icf = doc(['@schema', '', 'masters:', '  Vendor[]:', '    [VendorID, Name]', '', '@data', ''].join('\n'));
    expect(validate(icf).getWarnings().some((m) => m.code === 'RESERVED_OBJECT_NAME')).toBe(true);

    // ICX 1.1 §4: the rule applies to ICX documents too — the legacy
    // `index[]` shared structure now draws a (non-fatal) warning.
    const legacyIcx = ['@kind icx', '@version 1.0', '@schema', '', 'index[]:', '  [RecordID, UUID]', '', '@data', ''].join('\n');
    const legacy = validate(legacyIcx);
    expect(legacy.getWarnings().some((m) => m.code === 'RESERVED_OBJECT_NAME')).toBe(true);
    expect(legacy.isValid()).toBe(true);

    // the ICX 1.1 shared structure is clean
    const modernIcx = ['@kind icx', '@version 1.1', '@schema', '', 'recordindex[]:', '  [RecordID, UUID]', '', '@data', ''].join('\n');
    expect(validate(modernIcx).getWarnings().some((m) => m.code === 'RESERVED_OBJECT_NAME')).toBe(false);
  });

  it('resolves the ICX shared-index fallback via recordindex[] (v1.1) and index[] (legacy)', () => {
    const build = (shared: string): string =>
      [
        '@kind icx', '@version 1.1', '@schema', '',
        `${shared}[]:`, '  [RecordID, UUID, Line, Offset, Size, Checksum]', '',
        '@data', '', '@record', '',
        'Invoice:', '  - DOC1, , 10, 100, 50, sha256:abc', '',
      ].join('\n');
    for (const shared of ['recordindex', 'index']) {
      const parsed = parseLenient(build(shared));
      const row = parsed.getRecord(0)!.getData().path('Invoice').path(0);
      expect(row.path('RecordID').asText()).toBe('DOC1');
      expect(row.path('Checksum').asText()).toBe('sha256:abc');
    }
  });

  it('generates ICX at version 1.1 whose write → parse round trip is warning-free', async () => {
    const { generateIcx } = await import('../src/index.js');
    const icx = generateIcx(parse(V11), 'employee_v11.icf');
    expect(icx.getMetadata().getVersion()).toBe('1.1');
    const result = validate(write(icx));
    expect(result.getErrors()).toEqual([]);
    expect(result.getWarnings().map((m) => m.code)).not.toContain('RESERVED_OBJECT_NAME');
  });

  // ---- row markers & compact syntax --------------------------------------------

  it('warns WRONG_ROW_MARKER and COMPACT_COLLECTION_SYNTAX', () => {
    const wrongMarker = doc(
      ['@schema', '', 'X:', '  [a]', 'Y[]:', '  [b]', '', '@data', '', '@record', '', 'X:', '  - 1', '', 'Y:', '  = 2', ''].join('\n'),
    );
    const codes = validate(wrongMarker).getWarnings().map((m) => m.code);
    expect(codes.filter((c) => c === 'WRONG_ROW_MARKER')).toHaveLength(2);

    const compact = doc(
      ['@schema', '', 'Y[]:', '  [b]', '', '@data', '', '@record', '', 'Y:1', ''].join('\n'),
    );
    expect(validate(compact).getWarnings().some((m) => m.code === 'COMPACT_COLLECTION_SYNTAX')).toBe(true);
  });

  // ---- annotation diagnostics ----------------------------------------------------

  it('reports annotation misuse with the v1.1 diagnostic codes', () => {
    // unknown (non-namespaced) annotation — namespaced ones are accepted
    const unknown = doc(
      ['@schema', '', 'X:', '  [a]', '  !bogus:', '    = 1', '  !com.example.keep:', '    = 2', '', '@data', ''].join('\n'),
    );
    const unknownResult = validate(unknown);
    expect(unknownResult.getWarnings().filter((m) => m.code === 'UNKNOWN_ANNOTATION')).toHaveLength(1);

    // annotation with no owning object
    const orphan = doc(['@schema', '', '!defaults:', '  = a=1', '', 'X:', '  [a]', '', '@data', ''].join('\n'));
    expect(validate(orphan).getErrors().some((m) => m.code === 'ANNOTATION_WITHOUT_OWNER')).toBe(true);

    // row annotation with no preceding row
    const noRow = doc(
      ['@schema', '', 'X:', '  [a]', '', '@data', '', '@record', '', '!overrides:', '  = a=1', ''].join('\n'),
    );
    expect(validate(noRow).getErrors().some((m) => m.code === 'ROW_ANNOTATION_WITHOUT_ROW')).toBe(true);

    // malformed entries
    const malformed = doc(
      ['@schema', '', 'X:', '  [a]', '  !defaults:', '    = nodefault', '', '@data', ''].join('\n'),
    );
    expect(validate(malformed).getWarnings().some((m) => m.code === 'MALFORMED_ANNOTATION_ENTRY')).toBe(true);

    // annotation after child objects
    const late = doc(
      ['@schema', '', 'X:', '  [a]', '  child:', '    [c]', '  !indexes:', '    = a', '', '@data', ''].join('\n'),
    );
    expect(validate(late).getWarnings().some((m) => m.code === 'ANNOTATION_AFTER_CHILDREN')).toBe(true);
  });

  it('rows with a trailing empty cell do not swallow the next row', () => {
    // `a, ,` ends with a delimiter (empty last cell) — the next structural
    // line must terminate the pending row, not continue it.
    const text = doc(
      ['@schema', '', 'X[]:', '  [a, b, c]', '', '@data', '', '@record', '', 'X:', '  - a1, , ', '  - a2, b2, c2', ''].join('\n'),
    );
    const rows = parseLenient(text).getRecord(0)!.getData().path('X');
    expect(rows.size).toBe(2);
    expect(rows.path(0).path('a').asText()).toBe('a1');
    expect(rows.path(0).path('c').asText()).toBe('');
    expect(rows.path(1).path('c').asText()).toBe('c2');
  });

  it('structure-only ICX output (empty checksum cells) survives write → parse', async () => {
    const { generateIcx } = await import('../src/index.js');
    const source = parse(V11);
    const icx = generateIcx(source, 'employee_v11.icf');
    const reparsed = parseLenient(write(icx));
    // same number of index rows before and after the round trip
    expect(reparsed.getRecordCount()).toBe(icx.getRecordCount());
    expect(reparsed.getRecord(0)!.getData().toJsonString()).toBe(icx.getRecord(0)!.getData().toJsonString());
  });

  it('multiline and single-line rows are semantically identical (spec §60)', () => {
    const single = doc(
      ['@schema', '', 'X:', '  [a, b, c]', '', '@data', '', '@record', '', 'X:', '  = 1, two, three', ''].join('\n'),
    );
    const multi = doc(
      ['@schema', '', 'X:', '  [a, b, c]', '', '@data', '', '@record', '', 'X:', '  = 1,', '    two,', '    three', ''].join('\n'),
    );
    expect(parse(multi).getRecord(0)!.getData().toJsonString()).toBe(
      parse(single).getRecord(0)!.getData().toJsonString(),
    );
  });
});
