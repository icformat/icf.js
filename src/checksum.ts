/**
 * Self-describing checksums, async and browser-native.
 *
 * Mirrors icfj's `Checksums` registry, but every {@link compute} returns a
 * Promise (so sync and async hash methods unify) and is backed by Web Crypto.
 *
 * Values are self-describing: `"<method>:<hex>"`, e.g.
 * `sha256:ba7816bf...`.
 */

/** A hash function: raw digest bytes (sync or async) for the given input. */
export type HashFunction = (data: Uint8Array) => Uint8Array | Promise<Uint8Array>;

/** Built-in method name. */
export const SHA256 = 'sha256';
/** Built-in method name. */
export const CRC32 = 'crc32';
/** Reserved method name (registry-only; not built in for the browser). */
export const MD5 = 'md5';
/** Reserved method name (registry-only). */
export const CRC32C = 'crc32c';
/** Reserved method name (registry-only). */
export const XXH3 = 'xxh3';

/** Methods registered out of the box. */
export const BUILT_IN: ReadonlyArray<string> = [CRC32, SHA256];
/** Recognized spec names that need a registered provider in the browser. */
export const RESERVED: ReadonlyArray<string> = [MD5, CRC32C, XXH3];

const registry = new Map<string, HashFunction>();

function normalize(method: string): string {
  return method.trim().toLowerCase();
}

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

// ---- built-in hash functions --------------------------------------------

async function sha256Digest(data: Uint8Array): Promise<Uint8Array> {
  const buf = await crypto.subtle.digest('SHA-256', data as unknown as BufferSource);
  return new Uint8Array(buf);
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32Digest(data: Uint8Array): Uint8Array {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ data[i]!) & 0xff]!;
  }
  crc = (crc ^ 0xffffffff) >>> 0;
  // 4-byte big-endian digest (8 hex digits)
  return new Uint8Array([(crc >>> 24) & 0xff, (crc >>> 16) & 0xff, (crc >>> 8) & 0xff, crc & 0xff]);
}

registry.set(SHA256, sha256Digest);
registry.set(CRC32, crc32Digest);

// ---- public registry API ------------------------------------------------

/** Registers (or replaces) a hash method. Names are case-insensitive. */
export function register(method: string, fn: HashFunction): void {
  const key = normalize(method);
  if (key === '') throw new Error('Checksum method name must not be blank');
  if (typeof fn !== 'function') throw new Error('Checksum hash function must be a function');
  registry.set(key, fn);
}

/** Removes a registered method; returns whether one was removed. */
export function unregister(method: string): boolean {
  return registry.delete(normalize(method));
}

/** The currently registered (computable) method names, sorted. */
export function supportedMethods(): string[] {
  return [...registry.keys()].sort();
}

/** True when `method` is registered (and thus computable). */
export function isSupported(method: string): boolean {
  return registry.has(normalize(method));
}

/** True when `method` is registered **or** a reserved spec name. */
export function isRecognized(method: string): boolean {
  const key = normalize(method);
  return registry.has(key) || RESERVED.includes(key);
}

/**
 * Computes `"<method>:<hex>"` over `data`. Always returns a Promise.
 * Rejects (throws) when `method` is not registered.
 */
export async function compute(method: string, data: Uint8Array): Promise<string> {
  const key = normalize(method);
  const fn = registry.get(key);
  if (!fn) throw new Error(`Unsupported checksum method "${method}"`);
  const digest = await fn(data);
  return `${key}:${toHex(digest)}`;
}

/** All checksum helpers, grouped to mirror icfj's static `Checksums`. */
export const Checksums = {
  SHA256,
  CRC32,
  MD5,
  CRC32C,
  XXH3,
  BUILT_IN,
  RESERVED,
  register,
  unregister,
  supportedMethods,
  isSupported,
  isRecognized,
  compute,
};
