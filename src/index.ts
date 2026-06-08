/**
 * icf.js — a zero-dependency browser library for Indent Comma Format (ICF)
 * and ICX companion indexes. A faithful behavioral port of the Java `icfj`.
 *
 * This module is the public surface. See README.md / DOCUMENTATION.md.
 */

import { IcfDocument } from './document.js';
import { IcfNode } from './model/node.js';
import { IcfMetadata } from './model/metadata.js';
import { IcfParseError } from './errors.js';
import { IcfParser } from './parser/parser.js';
import { Severity, ValidationResult } from './validation.js';
import { IcfWriter, canonicalContentBytes } from './writer/writer.js';
import { IcxGenerator, IcxChecksumOptions } from './writer/icx.js';
import { compute, isSupported } from './checksum.js';

// ---- parse ---------------------------------------------------------------

/** Parses ICF text. Throws {@link IcfParseError} on error-level diagnostics. */
export function parse(text: string): IcfDocument {
  const result = new IcfParser().parse(text);
  const errors = result.getMessages().filter((m) => m.severity === Severity.ERROR);
  if (errors.length > 0) {
    throw new IcfParseError(`ICF parse failed with ${errors.length} error(s)`, errors);
  }
  return result.getDocument();
}

/** Best-effort parse — never throws on content errors. */
export function parseLenient(text: string): IcfDocument {
  return new IcfParser().parse(text).getDocument();
}

// ---- validate ------------------------------------------------------------

/** Collects errors + warnings without throwing on content problems. */
export function validate(text: string): ValidationResult {
  return new ValidationResult(new IcfParser().parse(text).getMessages());
}

/** True when {@link validate} reports no error-level diagnostics. */
export function isValid(text: string): boolean {
  return validate(text).isValid();
}

// ---- write ---------------------------------------------------------------

/** Serializes a document (faithful) or a built node (schema inferred). */
export function write(target: IcfDocument | IcfNode): string {
  return new IcfWriter().writeToString(target);
}

/**
 * Like {@link write}, but computes and emits a fresh `@checksum` over the
 * canonical content (spec §19) using the document's `@hashmethod`, replacing
 * any stored value. No `@checksum` is emitted when the method is unregistered.
 */
export async function writeWithChecksum(target: IcfDocument | IcfNode): Promise<string> {
  const writer = new IcfWriter();
  const doc = writer.toDocument(target);
  const method = doc.getMetadata().getHashMethod() ?? IcfMetadata.DEFAULT_HASH_METHOD;
  const checksum = isSupported(method) ? await compute(method, canonicalContentBytes(doc)) : null;
  return writer.writeToStringWithChecksum(doc, checksum);
}

// ---- ICX -----------------------------------------------------------------

/** Builds an ICX index as an {@link IcfDocument} (empty positional fields). */
export function generateIcx(source: IcfDocument, sourceFileName?: string): IcfDocument {
  return new IcxGenerator().generate(source, sourceFileName);
}

/** Builds an ICX index with computed checksums and positional fields. */
export function generateIcxWithChecksums(
  source: IcfDocument,
  options: IcxChecksumOptions = {},
): Promise<IcfDocument> {
  return new IcxGenerator().generateWithChecksums(source, options);
}

// ---- convenience ---------------------------------------------------------

/** Fetches a URL and parses the response body as ICF. */
export async function fetchIcf(url: string): Promise<IcfDocument> {
  const response = await fetch(url);
  return parse(await response.text());
}

// ---- re-exports ----------------------------------------------------------

export { IcfDocument, IcfRecord } from './document.js';
export { IcfError, IcfParseError, IcfWriteError } from './errors.js';
export {
  IcfNode,
  IcfObject,
  IcfArray,
  IcfString,
  IcfNull,
  IcfMissing,
  NodeType,
  NULL,
  MISSING,
} from './model/node.js';
export type { IcfValue, IcfJson } from './model/node.js';
export { IcfMetadata } from './model/metadata.js';
export { IcfMasters } from './model/masters.js';
export { IcfSchema, IcfSchemas, SchemaNode } from './model/schema.js';
export { Severity, ValidationMessage, ValidationResult, IcfValidator } from './validation.js';
export { IcfParser } from './parser/parser.js';
export { ParseResult } from './parser/result.js';
export { IcfEscaper } from './parser/escaper.js';
export { IcfWriter, WriterOptions, canonicalContentBytes, findMasterTypeSchema } from './writer/writer.js';
export { SchemaInference } from './writer/inference.js';
export { IcxGenerator } from './writer/icx.js';
export type { IcxChecksumOptions } from './writer/icx.js';
export {
  Checksums,
  register,
  unregister,
  supportedMethods,
  isSupported,
  isRecognized,
  compute,
  SHA256,
  CRC32,
  MD5,
  CRC32C,
  XXH3,
  BUILT_IN,
  RESERVED,
} from './checksum.js';
export type { HashFunction } from './checksum.js';
