import { describe, expect, it } from 'vitest';
import {
  generateIcx,
  generateIcxWithChecksums,
  joinTags,
  splitTags,
  parse,
  parseLenient,
  validate,
  write,
  writeResolved,
  IcxGenerator,
} from '../src/index.js';
import { fixture } from './helpers.js';

/** A source ICF with masters, FKs, record references and a summary attr. */
const SOURCE = [
  '@kind icf',
  '@version 1.1',
  '',
  '@schema id=Masters',
  '',
  'Project[]:',
  '  [ProjectID, Name]',
  '',
  'Folder[]:',
  '  [Path, Label]',
  '',
  '@schema id=Prompt',
  '',
  'prompt:',
  '  [PromptID, ProjectRef, FolderRef, Text]',
  '',
  '@masters',
  '',
  'Project:',
  '  - ICF, Indent Comma Format',
  '  - Struo, Struo Build System',
  '',
  'Folder:',
  '  - D\\:\\\\Struo, Struo workspace',
  '',
  '@data',
  '',
  '@record id=Prompt1 schema=Prompt summary=Setup\\ notes\\ for\\ ICF',
  '',
  'prompt:',
  '  = Prompt1, Project:ICF, , Initial setup discussion',
  '',
  '@record id=Prompt2 schema=Prompt',
  '',
  'prompt:',
  '  = Prompt2, Project:Struo, Folder:D\\:\\\\Struo, Build pipeline notes',
  '',
].join('\n');

describe('ICX v1.2', () => {
  it('joinTags / splitTags round-trip, including escaped + and backslashes', () => {
    const tags = ['Project:ICF', 'Folder:D:\\Struo', 'a+b', 'trail\\'];
    const cell = joinTags(tags);
    expect(splitTags(cell)).toEqual(tags);
    expect(splitTags('')).toEqual([]);
    expect(joinTags([])).toBe('');
    expect(splitTags(joinTags(['single']))).toEqual(['single']);
  });

  it('harvests typed master references as Tags (records and master FKs)', () => {
    const icx = generateIcx(parse(SOURCE), 'prompts.icf');
    const prompt1 = icx.getRecord(0)!.getData().path('Prompt').path(0);
    expect(splitTags(prompt1.path('Tags').asText())).toEqual(['Project:ICF']);
    const prompt2 = icx.getRecord(0)!.getData().path('Prompt').path(1);
    expect(splitTags(prompt2.path('Tags').asText())).toEqual(['Project:Struo', 'Folder:D:\\Struo']);
    // the schema field list gained the Tags column
    const node = icx.getSchema()!.getTopLevelNode('Prompt')!;
    expect(node.getFields()).toContain(IcxGenerator.TAGS_FIELD);
  });

  it('takes Summary from the record summary= attribute, provider wins', () => {
    const icx = generateIcx(parse(SOURCE), 'prompts.icf');
    const rows = icx.getRecord(0)!.getData().path('Prompt');
    expect(rows.path(0).path('Summary').asText()).toBe('Setup notes for ICF');
    expect(rows.path(1).path('Summary').asText()).toBe(''); // no attribute, padded

    const withProvider = generateIcx(parse(SOURCE), 'prompts.icf', {
      summaryProvider: (rec) => (rec.getId() === 'Prompt2' ? 'From provider' : null),
    });
    const rows2 = withProvider.getRecord(0)!.getData().path('Prompt');
    expect(rows2.path(0).path('Summary').asText()).toBe('Setup notes for ICF'); // attr fallback
    expect(rows2.path(1).path('Summary').asText()).toBe('From provider');
  });

  it('omits Tags/Summary columns entirely when no row has content', () => {
    const icx = generateIcx(parse(fixture('invoice.icf')));
    for (const node of icx.getSchema()!.getTopLevelNodes().values()) {
      expect(node.getFields()).toEqual([...IcxGenerator.INDEX_FIELDS]);
    }
    // and tags can be switched off
    const noTags = generateIcx(parse(SOURCE), 'p.icf', { tags: false });
    const node = noTags.getSchema()!.getTopLevelNode('Prompt')!;
    expect(node.getFields()).not.toContain(IcxGenerator.TAGS_FIELD);
  });

  it('emits @version 1.2 and @sourcebytes, and round-trips warning-free', async () => {
    const icx = await generateIcxWithChecksums(parse(SOURCE), {
      sourceFileName: 'prompts.icf',
      sourceText: SOURCE,
    });
    expect(icx.getMetadata().getVersion()).toBe('1.2');
    expect(icx.getMetadata().get('sourcebytes')).toBe(
      String(new TextEncoder().encode(SOURCE).length),
    );
    const reparsed = validate(write(icx));
    expect(reparsed.getErrors()).toEqual([]);
    expect(reparsed.getWarnings()).toEqual([]);
    // Tags survive the write → parse round trip
    const round = parseLenient(write(icx));
    const row = round.getRecord(0)!.getData().path('Prompt').path(1);
    expect(splitTags(row.path('Tags').asText())).toEqual(['Project:Struo', 'Folder:D:\\Struo']);
  });

  it('validates multi-tag cells per tag (whole-first, split fallback)', () => {
    const icx = (tagsCell: string): string =>
      [
        '@kind icx', '@version 1.2', '@schema', '',
        'recordindex[]:', '  [RecordID, UUID, Line, Offset, Size, Checksum, Tags]', '',
        '@masters', '',
        'Vendor:', '  - VEN001, , , , , ', '  - VEN002, , , , , ', '',
        '@data', '', '@record', '',
        'Invoice:', `  - INV1, , , , , , ${tagsCell}`, '',
      ].join('\n');
    // all tags resolve → clean
    const good = validate(icx('Vendor:VEN001+Vendor:VEN002'));
    expect(good.getWarnings().map((m) => m.code)).not.toContain('UNRESOLVED_MASTER_REFERENCE');
    // one dangling tag → exactly one warning naming that tag
    const bad = validate(icx('Vendor:VEN001+Vendor:V999'));
    const warnings = bad.getWarnings().filter((m) => m.code === 'UNRESOLVED_MASTER_REFERENCE');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.message).toContain('Vendor:V999');
    expect(warnings[0]!.message).not.toContain('VEN001');
  });

  it('appends tagProvider tags after harvested tags, deduplicated', () => {
    const icx = generateIcx(parse(SOURCE), 'p.icf', {
      tagProvider: (rec) => (rec.getId() === 'Prompt1' ? ['keyword', 'Project:ICF'] : []),
    });
    const row = icx.getRecord(0)!.getData().path('Prompt').path(0);
    expect(splitTags(row.path('Tags').asText())).toEqual(['Project:ICF', 'keyword']);
  });

  it('skips the ICF version gate for @kind icx documents', () => {
    const icx = '@kind icx\n@version 1.2\n@schema\n\nrecordindex[]:\n  [RecordID, UUID]\n\n@data\n';
    expect(validate(icx).getWarnings().map((m) => m.code)).not.toContain('HIGHER_MINOR_VERSION');
    // ICF documents keep the gate
    const icf = '@kind icf\n@version 1.2\n@schema\n\nX:\n  [a]\n\n@data\n';
    expect(validate(icf).getWarnings().map((m) => m.code)).toContain('HIGHER_MINOR_VERSION');
  });

  it('parses and round-trips tagindex[] / summaryindex[] documents', () => {
    const doc = [
      '@kind icx',
      '@version 1.2',
      '@schema',
      '',
      'recordindex[]:',
      '  [RecordID, UUID, Line, Offset, Size, Checksum]',
      '',
      'tagindex[]:',
      '  [Tag, RecordIDs]',
      '',
      'summaryindex[]:',
      '  [RecordID, Summary]',
      '',
      '@data',
      '',
      '@record',
      '',
      'tagindex:',
      '  - Project:ICF, Prompt1+Prompt3',
      '  - Project:Struo, Prompt2',
      '',
      'summaryindex:',
      '  - Prompt1, Setup notes',
      '',
    ].join('\n');
    const parsed = parseLenient(doc);
    expect(validate(doc).getErrors()).toEqual([]);
    const tagRows = parsed.getRecord(0)!.getData().path('tagindex');
    expect(tagRows.size).toBe(2);
    expect(splitTags(tagRows.path(0).path('RecordIDs').asText())).toEqual(['Prompt1', 'Prompt3']);
    const round = parseLenient(write(parsed));
    expect(round.getRecord(0)!.getData().toJsonString()).toBe(
      parsed.getRecord(0)!.getData().toJsonString(),
    );
  });

  it('writeResolved bakes defaults/overrides in and drops annotations', () => {
    const doc = parse(fixture('employee_v11.icf'));
    const out = writeResolved(doc);
    // no annotation lines survive
    expect(out).not.toMatch(/^\s*!/m);
    // resolved values are plain fields now
    const round = parse(out);
    const emp = round.getRecord(0)!.getData().path('employee');
    expect(emp.path('empstatus').asText()).toBe('employed');
    expect(emp.path('idstatus').asText()).toBe('issued');
    // the override landed on its row
    expect(round.getRecord(0)!.getData().path('salary').path(0).path('idstatus').asText()).toBe('tobeissued');
    // the extended schema declares the default-only fields
    const schema = round.getSchemas().get('Employee')!.getTopLevelNode('employee')!;
    expect(schema.getFields()).toEqual(['empid', 'empname', 'empemail', 'empstatus', 'idstatus']);
    // the original document was not mutated
    expect(doc.getRecord(0)!.getData().path('employee').has('empstatus')).toBe(false);
    expect(doc.getSchemas().get('Employee')!.getTopLevelNode('employee')!.getFields()).toEqual([
      'empid',
      'empname',
      'empemail',
    ]);
  });
});
