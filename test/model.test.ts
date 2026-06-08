import { describe, expect, it } from 'vitest';
import { IcfNode, NULL, MISSING, NodeType, parse, write } from '../src/index.js';

describe('model: type, navigation, mutation', () => {
  it('builds and navigates objects and arrays', () => {
    const root = IcfNode.object();
    const vendor = root.putObject('vendor');
    vendor.put('id', 'V001').put('email', 'v@example.com');
    const items = root.putArray('items');
    items.addObject().put('sku', 'A1').put('qty', 100);

    expect(root.type).toBe(NodeType.OBJECT);
    expect(root.path('vendor').path('id').asText()).toBe('V001');
    expect(root.path('items').path(0).path('qty').asText()).toBe('100');
    expect(root.path('missing').isMissing()).toBe(true);
    expect(root.get('missing')).toBeNull();
    expect(items.size).toBe(1);
  });

  it('keeps null distinct from the empty string', () => {
    const obj = IcfNode.object();
    obj.putNull('a');
    obj.put('b', '');
    expect(obj.get('a')!.isNull()).toBe(true);
    expect(obj.get('b')!.isString()).toBe(true);
    expect(obj.get('b')!.asText()).toBe('');
    expect(MISSING.isMissing()).toBe(true);
    expect(NULL.isNull()).toBe(true);
  });

  it('serializes to JSON', () => {
    const obj = IcfNode.object().put('a', '1').putNull('b');
    expect(obj.toJsonString()).toBe('{"a":"1","b":null}');
  });

  it('parses null vs empty cells distinctly', () => {
    const text = [
      '@kind icf',
      '@schema',
      '',
      'row:',
      '  [a, b, c]',
      '',
      '@data',
      '',
      '@record',
      '',
      'row:',
      '  = x, , null',
    ].join('\n');
    const doc = parse(text);
    const row = doc.getRecord(0)!.getData().path('row');
    expect(row.path('a').asText()).toBe('x');
    expect(row.get('b')!.isString()).toBe(true);
    expect(row.get('b')!.asText()).toBe('');
    expect(row.get('c')!.isNull()).toBe(true);
  });

  it('materializes scalar arrays through the writer', () => {
    const root = IcfNode.object();
    const tags = root.putArray('tags');
    tags.add('red').add('green');
    const out = write(root);
    const reparsed = parse(out);
    const arr = reparsed.getRecord(0)!.getData().path('tags');
    expect(arr.isArray()).toBe(true);
    expect(arr.path(0).path('value').asText()).toBe('red');
    expect(arr.path(1).path('value').asText()).toBe('green');
  });
});
