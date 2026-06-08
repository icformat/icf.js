import { afterEach, describe, expect, it } from 'vitest';
import {
  compute,
  isRecognized,
  isSupported,
  register,
  supportedMethods,
  unregister,
  BUILT_IN,
  RESERVED,
} from '../src/index.js';

const utf8 = (s: string) => new TextEncoder().encode(s);

describe('checksum registry', () => {
  afterEach(() => {
    // restore global registry state after custom registrations
    unregister('rot');
    unregister('md5');
  });

  it('matches the sha256 parity vector for "abc"', async () => {
    expect(await compute('sha256', utf8('abc'))).toBe(
      'sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('matches the crc32 parity vector for "abc"', async () => {
    expect(await compute('crc32', utf8('abc'))).toBe('crc32:352441c2');
  });

  it('exposes built-in and reserved method sets', () => {
    expect([...BUILT_IN].sort()).toEqual(['crc32', 'sha256']);
    expect([...RESERVED].sort()).toEqual(['crc32c', 'md5', 'xxh3']);
    expect(isSupported('sha256')).toBe(true);
    expect(isSupported('md5')).toBe(false);
    expect(isRecognized('md5')).toBe(true);
    expect(isRecognized('nope')).toBe(false);
  });

  it('registers, computes, and unregisters a custom method', async () => {
    register('rot', (data) => Uint8Array.from(data, (b) => (b + 1) & 0xff));
    expect(isSupported('rot')).toBe(true);
    expect(supportedMethods()).toContain('rot');
    expect(await compute('rot', new Uint8Array([0x00, 0xff]))).toBe('rot:0100');
    expect(unregister('rot')).toBe(true);
    expect(isSupported('rot')).toBe(false);
  });

  it('rejects blank names and computing unsupported methods', async () => {
    expect(() => register('', () => new Uint8Array())).toThrow();
    await expect(compute('xxh3', utf8('x'))).rejects.toThrow();
  });

  it('treats method names case-insensitively', async () => {
    expect(await compute('SHA256', utf8('abc'))).toBe(
      'sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});
