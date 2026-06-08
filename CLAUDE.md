# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

**`icf.js`** is a small, zero-dependency **browser** library (TypeScript) that parses, validates, builds in-memory, writes, and converts **Indent Comma Format (ICF)** text, and generates **ICX** companion indexes. It is a faithful behavioral port of the Java library [`icfj`](https://github.com/icformat/icfj), adapted for the browser.

The format specs live at [icformat.org](https://icformat.org): the **ICF format specification (v1)** and the **ICX index specification (v1)**. Read those before changing parser/writer behavior. When the spec is ambiguous, `icfj`'s observable behavior is the tiebreaker — `icf.js` mirrors its names almost 1:1 (the Java API is already camelCase).

Like `icfj`, this library generates ICX **as another `IcfDocument`** (via `IcxGenerator` / `generateIcx(...)`) which is then serialized with the standard `IcfWriter`. Output uses standard ICF row syntax (`= a, b, c`) rather than the spec's bare-row form, so it round-trips through this library's parser. There is no dedicated ICX parser; ICX text is read back via the regular `parse(...)`.

## Build & test

Node ≥ 20 (provides Web Crypto for the `sha256` tests). Zero runtime dependencies.

```bash
npm install
npm test            # vitest run (happy-dom environment)
npm run test:watch  # vitest watch
npm run typecheck   # tsc --noEmit for src and tests
npm run build       # tsup -> dist/ (ESM + IIFE + min + .d.ts)
```

**Build outputs (tsup):** `dist/icf.js` (ESM), `dist/icf.global.js` (IIFE exposing `window.ICF`), `dist/icf.min.js` (minified IIFE), and `dist/index.d.ts`. The `package.json` `exports`/`module`/`types`/`unpkg`/`jsdelivr` fields point at these. Published to npm and served via jsDelivr from GitHub tags.

There is no separate lint step — the TypeScript compiler is the only static check.

## Architecture: the big picture

ICF is **schema-driven**. A document declares a hierarchy of named nodes once (one or more `@schema` blocks, each optionally `@schema id=...`), optionally carries user metadata (`@metadata`) and shared reference data (`@masters`), then stores records positionally (`@data` + `@record`) using rows of comma-separated values matched to the schema's field order. Section order is `header directives → @metadata → @schema(s) → @masters → @data`. Records may select among multiple schemas via the `schema=` record attribute. The library mirrors this in three layers that must stay aligned:

1. **`src/model/`** — the in-memory model, pure TypeScript, **no dependencies**:
   - `node.ts`: `IcfNode` (abstract) → `IcfObject` / `IcfArray` / `IcfString` / `IcfNull` / `IcfMissing` — the data DOM (JSON-tree-style, with `path()` returning `IcfMissing` for safe chaining). `IcfNull` / `IcfMissing` are exported as module-level singletons (`NULL`, `MISSING`) and via `IcfNode.nullNode()` / `IcfNode.missing()`.
   - `schema.ts`: `SchemaNode` + `IcfSchema`. `IcfSchemas` is a keyed collection of these (one per `@schema id=...`); the document holds an `IcfSchemas`, with `getSchema()` returning the default for backward compatibility.
   - `masters.ts`: `IcfMasters` — typed map of `Type → IcfArray<IcfObject>` for the `@masters` section. The first field of each row is the primary key; `find(...)` and `resolveReference("Type:Id")` use it.
   - `metadata.ts`: `IcfMetadata` — `@`-directives (resolves `@delimiter`/`@escape` to actual chars) plus the user `@metadata` section (spec §5) in a separate map.

2. **`src/parser/`** — `IcfParser.parse` is single-pass, **resilient**: it never throws on content errors; it collects `ValidationMessage`s and returns a best-effort `IcfDocument` inside a `ParseResult`. The facade decides whether to surface errors. The state machine has five sections (`HEADER → METADATA → SCHEMA → MASTERS → DATA`); the masters reader uses a simple "current type" pointer (masters are flat), while schema and data each use an indentation stack that pops frames whose `indent >= current`. `escaper.ts` holds the three escape contexts + unified unescape. `result.ts` is the `ParseResult` wrapper.

3. **`src/writer/`** — `IcfWriter` is the schema-driven serializer. `writeToString(IcfDocument)` is the round-trip-faithful path; `writeToString(IcfNode)` calls `SchemaInference.infer(...)` (`inference.ts`) to derive a schema from a programmatically built node, then writes via the same routine. `icx.ts` holds `IcxGenerator`.

`src/index.ts` is the **public surface** (`parse`, `parseLenient`, `validate`, `isValid`, `write`, `writeWithChecksum`, `generateIcx`, `generateIcxWithChecksums`, `fetchIcf`) and the **only** intended entry point for casual users. `src/checksum.ts` is the async hash-method registry.

## Browser-specific deltas (vs. icfj)

These are the deliberate departures from the Java library — preserve them:

- **No filesystem / streams.** There are no `Path`/`Reader`/`InputStream` overloads. Inputs are **strings**; outputs are **strings**. A leading UTF-8 BOM is stripped at every parse entry point.
- **Checksums are async.** `src/checksum.ts` is Web-Crypto-backed and `compute(...)` **always returns a `Promise`** (so sync `crc32` and async `sha256` unify). Consequently the checksum-bearing facades are async: `writeWithChecksum(...)` and `generateIcxWithChecksums(...)`. Everything else — parse, build, validate, `write`, `generateIcx`, ICX structure — stays **synchronous**.
- **`md5` is not built in** (no native browser implementation): it is a **reserved, registry-only** name alongside `crc32c`/`xxh3`. `sha256` (default) and `crc32` are built in. Reserved names are *recognized* but not *supported* until an app registers a provider; generation degrades gracefully (leaves computed fields empty) rather than throwing.
- **`fetchIcf(url)`** is the only network helper: `fetch(url).then(r => r.text()).then(parse)`. Kept tiny and separate.
- **`WriterOptions`** is a JS-idiomatic class with plain public fields, fluent setters, `WriterOptions.defaults()`, and `WriterOptions.from(partial)`; `new IcfWriter(options)` accepts either an instance or a partial object.

## The "leaf XOR container" invariant

ICF cannot represent a node that mixes scalar fields and child objects at the same level. A schema/data node is either:
- a **container** — has children, mapped to a nested object, never gets a `= row`; or
- a **leaf** — has only scalar `fields`, gets one `= row` (object) or many (collection, `Name[]:`).

The same `[a, b, c]` syntax means "child names" in containers and "scalar field names" in leaves — disambiguated by whether children are declared. Both halves enforce this:
- Parser raises `ROW_ON_CONTAINER` when a row appears under a node with children.
- `SchemaInference` throws `IcfWriteError` on mixed objects, naming the offending node.

When changing parser or writer behavior, preserve this invariant or you'll break round-trips.

## Spec gotchas that shape the code

1. **`null` ≠ empty string.** A bare `null` literal becomes `IcfNull`; a `,,` cell becomes `IcfString("")`. They must remain distinct end-to-end.
2. **Three escape contexts** (`escaper.ts`) — pick the right one or the writer over-escapes:
   - `escape(...)` — conservative, for declaration names and field-list entries (covers `[ ] : = @ #` plus delimiter, escape, control).
   - `escapeValue(...)` — minimal, for row values (only delimiter, escape, and `\n \t \r`). Keeps `Vendor:VEN001` and `vendor@example.com` legible.
   - `escapeAttribute(...)` — for `@record` attribute values: escapes whitespace and the escape char, but **not** `=` (the parser splits attributes on the first `=`).
   `unescape(...)` reverses all three on read.
3. **Record attributes.** Tokenized with escape awareness so `note=South\ Zone` survives. Reserved names with shorthand getters on `IcfRecord`: `id`, `uuid`, `created`, `modified`, `revision`, `schema`. `schema=` drives multi-schema record interpretation.
4. **Row markers** (spec §9/§12). `=` is the single-row-object marker; `-` is the collection-row marker. The parser accepts either in every context. The writer chooses by `SchemaNode.isCollection()` — collections get `-`, leaf objects get `=`. For masters, the type's schema declaration (`Vendor[]:` vs `Vendor:`) drives the same choice.
5. **Compact Object Syntax** (spec §12). `Vendor:VEN001, ABC, City` ≡ `Vendor:` + `= VEN001, ABC, City`. Detection: line doesn't start with a structural char (`= - << [ @`), the first unescaped colon has no whitespace before it (and the name part has no whitespace), and ≥1 char follows the colon. Master references inside `= ...` rows are *not* compact syntax.
6. **UTF-8 BOM** (spec §24). A single leading `﻿` is stripped at the top of `parse`.
7. **Version compatibility** (spec §23). `IcfParser.SUPPORTED_MAJOR_VERSION` / `SUPPORTED_MINOR_VERSION` = 1.0. Higher major → `UNSUPPORTED_MAJOR_VERSION` error + best-effort continue; higher minor → `HIGHER_MINOR_VERSION` warning + continue.
8. **Preformatted text blocks** (spec §18). `<<TAG ... TAG>>` opens a verbatim region under a leaf. Mode state is checked at the very top of the parse loop, so `@`-directives, `#`, and structural chars are deliberately not interpreted while a block is open. The parser strips the opening tag's indentation prefix from each content line (YAML literal-block style); the writer re-applies it. Together they make multiline values stable across parse → write → parse. The block fills the leaf's only field (the first declared field, or `field1`).
9. **Two master-schema styles.** Both round-trip: (a) legacy `masters:` container with type children inside any schema; (b) new style where master types are top-level collections inside a dedicated `@schema id=Masters` block. `masterTypeSchema` / `findMasterTypeSchema` search legacy-container-first then top-level; the writer mirrors that order.
10. **`@kind` and `@records`** are special-cased in `render`:
    - `@kind` is always emitted **first**, defaulting to `"icf"`. `IcxGenerator` seeds `@kind icx`.
    - `@records` is auto-computed from the record count unless the metadata carries an explicit value. `IcxGenerator` sets an explicit `@records` (master rows + source records), because the ICX document holds all index collections in a single synthetic ICF record. Both keys are skipped in the generic directive loop to avoid duplicate emission.
11. **Multiple `@schema id=X`** blocks are keyed in `IcfSchemas`; records select via `schema=`, else the default (anonymous if present, else the first declared).
12. **ICX shared `index[]` fallback** (ICX §5). When a `@masters`/`@data` type isn't declared, the parser synthesizes a `SchemaNode` from the document's top-level `index` / `index[]` node fields. `findSharedIndexFields` is the single source of truth; both master lookup and record-data lookup use it.
13. **Scalar arrays aren't native.** The writer materializes `["a","b"]` as rows of a single-field object using `WriterOptions.scalarArrayField` (default `"value"`). Round-trip of `["a","b"]` becomes `[{value:"a"},{value:"b"}]` — by design.
14. **Section order + state machine.** HEADER → METADATA → SCHEMA → MASTERS → DATA. Schema/data use indentation stacks; masters use a flat current-type pointer.
15. **Indentation.** 2-space; a tab counts as 1 column and emits a non-fatal `TAB_INDENT` warning.
16. **Resilient parser.** `IcfParser.parse` never throws on content errors — it accumulates `ValidationMessage`s and returns a best-effort document in a `ParseResult`. The facade `parse` throws `IcfParseError` when any ERROR-severity message exists; `parseLenient` never throws. Preserve stable diagnostic codes (`ROW_ON_CONTAINER`, `TAB_INDENT`, version codes, etc.).

## Checksums (`src/checksum.ts`)

- Values are **self-describing**: `"<method>:<hex>"` (e.g. `sha256:ba7816bf...`).
- A `HashFunction` is `(data: Uint8Array) => Uint8Array | Promise<Uint8Array>` returning raw digest bytes; `compute` awaits it, hex-encodes, and prepends the method name. **`compute` always returns a Promise.**
- Built-ins: `sha256` (`crypto.subtle.digest('SHA-256', ...)`, async) and `crc32` (sync table-based, 4-byte big-endian → 8 hex digits).
- Reserved (registry-only, not built in): `md5`, `crc32c`, `xxh3`.
- Registry API: `register`, `unregister`, `supportedMethods`, `isSupported`, `isRecognized`, `compute`. Case-insensitive names; `register` rejects a blank name / non-function. Constants `SHA256`/`CRC32` (built-in), `MD5`/`CRC32C`/`XXH3` (reserved), `BUILT_IN`, `RESERVED`.
- **Parity vectors (test these):** `compute('sha256', utf8('abc'))` → `sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad`; `compute('crc32', utf8('abc'))` → `crc32:352441c2`.

### Generation-time checksums (`generateIcxWithChecksums`, async)

Honors the resolved `@hashmethod` (source ICF's, else `sha256`):
- Emits `@hashmethod` (source's if present, else `sha256`).
- `@sourcechecksum`: copies the source ICF's `@checksum` if present (spec: "same value"), else computes over `canonicalContentBytes(source)`.
- `@sourcefilechecksum`: computes over the literal `sourceText` bytes when provided.
- Per-record index `Checksum`: computes over each record body (`IcfWriter.recordBody`); per-master `Checksum` over the master row (`IcfWriter.masterRow`). `Line`/`Offset`/`Size` are scanned from `sourceText` for data records (advisory, ICX §8).
- **Graceful degradation:** if the method isn't `isSupported(...)`, computed fields are left empty — never throws. `@hashmethod` is still emitted and the `@sourcechecksum` copy still works.

### Write-time checksum injection (`writeWithChecksum`, async)

The facade resolves the document, computes the checksum over `canonicalContentBytes(doc)` using the document's `@hashmethod` (when supported), then calls `IcfWriter.writeToStringWithChecksum(doc, checksum)`. That path drops any stored `@checksum` from the generic directive loop and emits the fresh one after `@records`. Default `write` stays sync and checksum-free.

**Invariant to test:** an ICF's written `@checksum` equals its ICX's `@sourcechecksum` — both use the shared `canonicalContentBytes`, which re-serializes with default options and slices from the line that is exactly `@schema` or starts with `@schema ` (so `@schema-url` is excluded).

## Keep DOCUMENTATION.md in sync

`DOCUMENTATION.md` is the canonical reference for the public API. **Whenever a change adds, renames, removes, or meaningfully changes the signature of any exported member**, update `DOCUMENTATION.md` in the same change. Internal/private members do not belong there. Run `npm test` + `npm run typecheck` — green tests, clean types, and updated docs is the bar for "done".

## Test layout

Vitest (`happy-dom`). Four canonical fixtures in `test/fixtures/`, with the four round-trip tests as the strongest correctness checks (run these first whenever you change parser or writer output):
- `invoice.icf` — single anonymous schema with a nested container and a collection; no masters/attributes.
- `invoice_with_masters.icf` — legacy `masters:` container, master references, and an escaped-whitespace attribute (`note=South\ Zone`).
- `multi_schema.icf` — `@metadata`, multiple `@schema id=...` blocks, top-level master collections, `-` master rows, and `@record schema=...`.
- `textblock.icf` — text blocks under leaf nodes (OCR text with embedded `@record`/`#`/`:` characters, a JSON config block).

The remaining suites cover the model (type/navigation/mutation, `null` vs empty, scalar arrays), spec compliance (row markers, compact syntax, version checks, BOM, `@kind`/`@records`, ICX shared-index fallback), the checksum registry (parity vectors, register/compute/unregister with global-state restore in teardown, reserved-method graceful degradation), and the writer (default emits no `@checksum`, `writeWithChecksum` matches `compute(...)`, stale `@checksum` replaced once, ICF `@checksum` ≡ ICX `@sourcechecksum`).
