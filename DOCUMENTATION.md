# icf.js — Public API

Zero-dependency **browser & Node** library (written in TypeScript) to parse, validate, build, write, and index **Indent Comma Format (ICF)** text, and generate **ICX** companion indexes. A faithful behavioral port of the Java library [`icfj`](https://github.com/icformat/icfj). Implements **ICF specification v1.1** and **ICX specification v1.2**.

- **Package:** `icf.js` (ESM + CommonJS + IIFE global `window.ICF`, with bundled TypeScript types)
- **Runtime:** modern browsers / Node ≥ 20 (needs Web Crypto for `sha256`)
- **Encoding:** UTF-8. A leading BOM is stripped on parse. Inputs and outputs are **strings** (no file/stream I/O).

> This file is the canonical reference for the public API, kept in sync with the source by hand. Any change that adds, renames, or removes an exported member must be reflected here in the same change. See `CLAUDE.md` for the maintenance rule.

---

## What's new in 1.2.0 (ICX spec v1.2)

- **`Tags` / `Summary` index fields** (ICX v1.2 §7–§8): `generateIcx` auto-harvests typed master references from every index row as `Tags` (joined with `+`); `Summary` comes from a `summaryProvider` option or the record's `summary=` attribute. Columns appear only when at least one row has content. Helpers `joinTags(tags)` / `splitTags(cell)` are exported.
- **`IcxGenerateOptions`**: `generateIcx(source, sourceFileName?, { tags?, summaryProvider?, tagProvider? })`; `IcxChecksumOptions` extends it. `tagProvider` supplies extra tags per record, appended after harvested tags and deduplicated.
- **Multi-tag validation** (ICX v1.2 §7): the referential-integrity scan resolves a value whole first; on failure a cell containing an unescaped `+` is split and each typed tag validated individually — generated multi-tag indexes round-trip warning-free.
- **`writeResolved` widening**: master rows are resolved too, and export field lists include observed `!overrides` keys as well as `!defaults` keys.
- **`@sourcebytes`**: emitted by `generateIcxWithChecksums` when `sourceText` is supplied (UTF-8 byte length).
- **`tagindex[]` / `summaryindex[]`** (ICX v1.2 §9) parse and round-trip as ordinary collections.
- **`writeResolved(document)`**: resolved export — records serialized with `!defaults`/`!overrides` baked in, field lists extended, all annotations dropped; the input is never mutated.
- **ICX version gate**: the ICF `@version` check no longer applies to `@kind icx` documents (their `@version` is the ICX spec version). `IcxGenerator.DEFAULT_ICX_VERSION` is `"1.2"`.

---

## What's new in 1.1.0 (ICF spec v1.1)

- **`@version 1.1`** accepted (1.2+ warns `HIGHER_MINOR_VERSION`, 2.x errors).
- **Schema annotations** (`!indexes`, `!defaults`, `!constraints`, `!expressions`, plus namespaced `!com.example.*`) parsed, preserved, and round-tripped. Accessors on `SchemaNode`: `getAnnotations()`, `getIndexes()`, `getDefaults()`, `getConstraints()`, `getExpressions()`.
- **Row annotations** (`!overrides` after a row) attached to the row's `IcfObject`: `getRowAnnotations()`, `getOverrides()`, `hasRowAnnotations()`.
- **Primary objects**: `@record … primary=a,b` via `IcfRecord.getPrimary()`; reference resolution is **primary-first, then masters** (`IcfDocument.resolveReference(record, "Type:Id")`).
- **Resolution API** (processing-model Phase 5): `IcfDocument.getResolvedRecordData(recordOrIndex)` returns a deep copy with `!defaults` filled and `!overrides` applied; the parsed model is never mutated. Standalone `resolveReference` / `resolveRecordData` / `findPrimaryObject` are also exported.
- **Multiline value rows** (spec §59): rows ending with a trailing delimiter continue on following lines.
- **Constraint validation**: `required` / `unique` produce warnings (`REQUIRED_FIELD_MISSING`, `UNIQUE_CONSTRAINT_VIOLATION`); unknown keywords warn `UNKNOWN_CONSTRAINT`. Never invalidates a document.
- **New diagnostics** (all non-fatal unless noted): `RESERVED_OBJECT_NAME`, `UNKNOWN_ANNOTATION`, `ANNOTATION_WITHOUT_OWNER` (error), `ANNOTATION_AFTER_CHILDREN`, `MALFORMED_ANNOTATION_ENTRY`, `ROW_ANNOTATION_WITHOUT_ROW` (error), `PRIMARY_OBJECT_NOT_FOUND`, `UNRESOLVED_PRIMARY_REFERENCE`, `WRONG_ROW_MARKER`, `COMPACT_COLLECTION_SYNTAX`.
- **Record attributes**: `IcfRecord.getChecksum()` and `getPrimary()` join the existing shorthand getters.
- **Node support**: a CommonJS build (`dist/icf.cjs`) ships alongside ESM — `require('icf.js')` now works; no separate "icfts" package is needed.
- **ICX v1.1**: ICX now follows ICF language policies (indentation + reserved names). The shared index structure is `recordindex[]` (`index[]` still read for ICX 1.0 compat, with a `RESERVED_OBJECT_NAME` warning); generated ICX declares `@version 1.1`. `@index` is surfaced via `IcfMetadata.getIndex()`.
- **Non-goals in 1.1.0** (documented, spec-optional): expression *evaluation* and strict-validation mode.

---

## Install

Published on npm as [`icf.js`](https://www.npmjs.com/package/icf.js) (current version **1.2.0**).

```bash
npm install icf.js
```

```ts
// Node or bundler — ESM
import { parse, validate, write } from 'icf.js';

// Node — CommonJS
const { parse, validate, write } = require('icf.js');
```

Works in Node (≥ 20) and TypeScript projects out of the box — the package ships ESM (`dist/icf.js`), CommonJS (`dist/icf.cjs`) and bundled type declarations, so **no separate TypeScript/Node package is needed**.

No build step required in the browser — use it straight from a CDN. Pin a major version (`@1`) for stability:

```html
<!-- ES module via jsDelivr -->
<script type="module">
  import { parse } from 'https://cdn.jsdelivr.net/npm/icf.js@1/+esm';
</script>

<!-- …or the global IIFE build, exposing window.ICF -->
<script src="https://cdn.jsdelivr.net/npm/icf.js@1"></script>
```

The same files are served by unpkg (`https://unpkg.com/icf.js@1`). TypeScript types ship in the package (`dist/index.d.ts`).

---

## Quick start

```ts
import { parse, validate, write, IcfNode } from 'icf.js';

// 1. Parse and navigate
const doc  = parse(icfText);
const data = doc.toIcfNode();
const city = data.path('indexdata').path('masterindex')
                 .path('Project').path('Location').asText();

// 2. Validate
const result = validate(icfText);
if (!result.isValid()) result.getErrors().forEach((e) => console.warn(e.toString()));

// 3. Build a node from scratch and write it
const root = IcfNode.object();
root.putObject('vendor').put('id', 'V001').put('email', 'v@example.com');
root.putArray('items').addObject().put('sku', 'A1').put('qty', 100);
const icf = write(root);
```

Differences from `icfj` (browser deltas): no file/stream overloads; **checksums are async** (`writeWithChecksum`, `generateIcxWithChecksums`); **`md5` is reserved**, not built in (only `sha256` and `crc32` are built in).

---

## 1. Facade functions (module exports)

### Parse
| Function | Description |
|---|---|
| `parse(text: string): IcfDocument` | Parses ICF text. Throws `IcfParseError` if it contains error-level diagnostics. |
| `parseLenient(text: string): IcfDocument` | Best-effort parse, never throws on content errors. Inspect issues via `validate(...)`. |

Comment lines (spec v1.1 §55) — lines whose first non-blank character is `#` (`IcfParser.COMMENT_CHAR`) — are ignored everywhere outside preformatted text blocks, exactly like blank lines. Comments are discarded on parse (the spec permits this), so the writer never re-emits them and they never affect checksums.

### Validate
| Function | Description |
|---|---|
| `validate(text: string): ValidationResult` | Collects errors + warnings. Never throws on content problems. |
| `isValid(text: string): boolean` | True when `validate(...)` reports no errors. |

### Write
| Function | Description |
|---|---|
| `write(target: IcfDocument \| IcfNode): string` | Faithful for a document (uses its own metadata + schema; `parse → write → parse` round-trips). For a built node, infers a schema (object → one record; array → many). Throws `IcfWriteError` on non-representable shapes. |
| `writeWithChecksum(target: IcfDocument \| IcfNode): Promise<string>` | **async.** Like `write`, but computes and emits a fresh `@checksum` over the canonical content (spec §19) using the document's `@hashmethod`, replacing any stored value. No `@checksum` is emitted when the method is unregistered. |

### Generate ICX (companion index)
| Function | Description |
|---|---|
| `generateIcx(source: IcfDocument, sourceFileName?: string): IcfDocument` | Builds the ICX index as an `IcfDocument` (serialize with `write(...)`). Positional and checksum fields are empty. `sourceFileName` adds `@source`. |
| `generateIcxWithChecksums(source: IcfDocument, options?: IcxChecksumOptions): Promise<IcfDocument>` | **async.** Computes `@sourcechecksum`, `@sourcefilechecksum`, and per-record/per-master `Checksum`; populates `Line`/`Offset`/`Size` when `sourceText` is supplied. |

`IcxChecksumOptions`: `{ sourceFileName?: string; sourceText?: string }`.

### Convenience
| Function | Description |
|---|---|
| `fetchIcf(url: string): Promise<IcfDocument>` | `fetch(url).then(r => r.text()).then(parse)`. |

---

## 2. `IcfNode` — the native data tree

Abstract base for the five node kinds: `IcfObject`, `IcfArray`, `IcfString`, `IcfNull`, `IcfMissing`. JSON-tree-style API; `path(...)` returns `IcfMissing` (never `null`) so chains can't throw.

### Factories (static)
| Member | Description |
|---|---|
| `IcfNode.object(): IcfObject` | New empty object. |
| `IcfNode.array(): IcfArray` | New empty array. |
| `IcfNode.text(value: string): IcfString` | A scalar text node (empty string allowed). |
| `IcfNode.nullNode(): IcfNull` | The explicit-`null` singleton (also exported as `NULL`). |
| `IcfNode.missing(): IcfMissing` | The missing-lookup singleton (also exported as `MISSING`). |
| `IcfNode.of(value: string \| null): IcfNode` | `null` → `IcfNull`; otherwise `IcfString`. |

### Type
`node.type` → `NodeType` (`OBJECT \| ARRAY \| STRING \| NULL \| MISSING`).
`isObject()`, `isArray()`, `isString()`, `isNull()`, `isMissing()`, `isContainer()`, `isValue()`.

### Navigation
| Member | Description |
|---|---|
| `get(key: string \| number): IcfNode \| null` | Field of an object / element of an array, or `null` if absent. |
| `path(key: string \| number): IcfNode` | Like `get` but returns `IcfMissing` instead of `null`. |
| `has(key: string \| number): boolean` | |
| `size: number` | Field count (object) or element count (array). |
| `length: number` | Alias of `size` (reads naturally on arrays). |
| `isEmpty(): boolean` | |
| `fieldNames(): string[]` | Object field names, in insertion order. |
| `fields(): Array<[string, IcfNode]>` | Ordered `name → node` entries. |
| `elements(): IcfNode[]` | Ordered array elements. |

### Value access
| Member | Description |
|---|---|
| `textValue: string \| null` | Raw string for `IcfString`; `null` for every other kind. |
| `asText(defaultValue = ''): string` | Best-effort text: the value for strings, the default otherwise. |

### Serialization
| Member | Description |
|---|---|
| `toJsonString(): string` | Compact JSON. |
| `toPrettyString(): string` | Indented JSON (2 spaces). |
| `toJSON(): IcfJson` | Plain JSON value (used by `JSON.stringify`). |
| `toString(): string` | Same as `toJsonString()`. |

Module-level singletons: `NULL` (an `IcfNull`), `MISSING` (an `IcfMissing`).

---

## 3. `IcfObject` — build & mutate (extends `IcfNode`)

`put`/`set` return `this`; `putObject` / `putArray` return the **new child**. `put(name, value)` accepts `string | number | boolean | null | IcfNode` (`IcfValue`) and normalizes (`null` → `IcfNull`; scalars → `IcfString`).

| Method | Returns | Description |
|---|---|---|
| `set(name, value: IcfValue)` | `this` | `null` → `IcfNull`. |
| `put(name, value: IcfValue)` | `this` | Alias of `set`. |
| `putNull(name)` | `this` | Explicit null. |
| `putObject(name)` | the new `IcfObject` | Adds a fresh child and descends. |
| `putArray(name)` | the new `IcfArray` | Adds a fresh child and descends. |
| `remove(name)` | the removed `IcfNode` \| `null` | |
| `hasRowAnnotations()` | `boolean` | True when the row carries `!annotations` (spec v1.1 §46). |
| `getRowAnnotations()` | `Map<string, string[]>` | Ordered `name → entries` (live view; created on demand). |
| `addRowAnnotationEntries(name, entries)` | `void` | Appends entries (same name merges). |
| `getOverrides()` | `Map<string, string>` | `!overrides` parsed as `field → value` (spec v1.1 §47). |

---

## 4. `IcfArray` — build & mutate (extends `IcfNode`)

`add` returns `this`; `addObject` / `addArray` return the **new child**.

| Method | Returns | Description |
|---|---|---|
| `add(value: IcfValue)` | `this` | `null` → `IcfNull`; scalars → `IcfString`. |
| `addNull()` | `this` | |
| `addObject()` | the new `IcfObject` | Appends and descends. |
| `addArray()` | the new `IcfArray` | Appends and descends. |

---

## 5. `IcfDocument`

| Method | Description |
|---|---|
| `getMetadata(): IcfMetadata` | |
| `getSchema(): IcfSchema \| null` | The **default** schema (anonymous if present, else the first declared). |
| `getSchemas(): IcfSchemas` | All schemas, keyed by id (spec §7). |
| `getMasters(): IcfMasters` | Master-data section (empty if absent). |
| `hasMasters(): boolean` | |
| `getRecords(): IcfRecord[]` | |
| `getRecordCount(): number` | |
| `getRecord(index): IcfRecord \| null` | |
| `resolveReference(record, "Type:Id"): IcfObject \| null` | v1.1 §45 order: the record's `primary=` objects first, then masters. `record` may be `null`. |
| `getResolvedRecordData(recordOrIndex): IcfObject \| null` | Deep copy with `!defaults` filled and `!overrides` applied (Phase 5). Never mutates the parsed model. |
| `toIcfNode(): IcfNode` | One record → its object; otherwise an array of records. |
| `getRecordsAsArray(): IcfArray` | Always an array, regardless of record count. |
| `toJsonString(): string` / `toPrettyString(): string` | JSON of the data. |

Constructor: `new IcfDocument(metadata, schema | schemas, masters, records)` — accepts either a single `IcfSchema` (wrapped under the default id) or an `IcfSchemas`.

### Standalone resolution helpers (v1.1)

Also exported as module functions (the document methods above delegate to them):

| Function | Description |
|---|---|
| `resolveReference(document, record \| null, "Type:Id")` | Primary-first, then masters (spec §45). |
| `resolveRecordData(document, record): IcfObject` | Deep copy with `!defaults` + `!overrides` applied. |
| `findPrimaryObject(recordData, name, id): IcfObject \| null` | Record-local lookup by the row's first field (the primary-key rule). |

---

## 6. `IcfRecord`

| Method | Description |
|---|---|
| `getData(): IcfObject` | Record body as a native object. |
| `getAttributes(): Map<string,string>` | Attributes from the `@record` line, in declaration order. |
| `getAttribute(name): string \| null` | |
| `getId()` / `getUuid()` / `getCreated()` / `getModified()` / `getRevision()` / `getChecksum()` | Reserved-attribute shorthands (spec v1.1 §38). |
| `getSchemaId(): string \| null` | The `schema=` attribute, or `null` (record uses the default schema). |
| `getPrimary(): string[]` | Object names from the `primary=` attribute (spec v1.1 §39); `[]` when absent. |

Constructor: `new IcfRecord(attributes: Map<string,string>, data: IcfObject)`. Attribute values may contain escaped whitespace (`note=South\ Zone` → `"South Zone"`).

---

## 7. `IcfMasters` — the `@masters` section

Typed collection of reusable master rows (spec §13). The **first field is the primary key**.

| Member | Description |
|---|---|
| `isEmpty()` / `typeCount()` / `totalEntryCount()` | |
| `getTypes(): string[]` | All declared type names, in order. |
| `hasType(typeName): boolean` | |
| `getType(typeName): IcfArray \| null` | All entries for a type. |
| `asMap(): Map<string, IcfArray>` | Ordered. |
| `putType(typeName): IcfArray` | Returns the array, creating it if absent. |
| `addEntry(typeName): IcfObject` | Appends a fresh empty entry, returns it. |
| `find(typeName, primaryKey): IcfObject \| null` | Looks up by the value of the first field. |
| `resolveReference(reference): IcfObject \| null` | Parses `"Type:Id"` and returns the entry. Works for a reference held in a record field **or in another master's field** (master-to-master foreign keys, spec §13). |
| `static MASTERS_NODE_NAME` | The reserved schema container name (`"masters"`). |

A master row may reference another master via the standard `Type:Id` syntax in a field value (a foreign key), e.g. a `Project` row ending in `Vendor:V001`. References are stored as plain strings and resolved on demand with `resolveReference(...)`; validation reports a non-fatal `UNRESOLVED_MASTER_REFERENCE` when a `Type:Id` value whose `Type` is a declared master type does not resolve.

---

## 8. Schema model

### `SchemaNode`
A schema node is a **container** (`getChildren()` non-empty → nested object), a **leaf object** (no children, scalar `fields` → one `=` row), or a **leaf collection** (`isCollection()` → zero-or-more rows → array).

| Member | Description |
|---|---|
| `name: string` | |
| `collection: boolean` / `isCollection()` / `setCollection(b)` | |
| `isLeaf(): boolean` | True iff there are no children. |
| `getFields(): string[]` / `setFields(string[])` | Declared field names, in order. |
| `getChildren(): Map<string, SchemaNode>` | Ordered. |
| `getChild(name)` / `hasChild(name)` / `addChild(child)` | |
| `hasAnnotations()` / `getAnnotations()` / `getAnnotation(name)` / `addAnnotationEntries(name, entries)` | Raw ordered `!annotation → entries` storage (spec v1.1 §25). |
| `getIndexes(): string[]` | `!indexes` entries, e.g. `["empid", "department+empid"]`. |
| `getDefaults(): Map<string,string>` | `!defaults` parsed from `k=v` entries. |
| `getConstraints(): Map<string,string[]>` | `!constraints` parsed from `field:keyword` entries. |
| `getExpressions(): Map<string,string>` | `!expressions` parsed from `k=expr` entries (never evaluated by the library). |

`STANDARD_SCHEMA_ANNOTATIONS` (exported constant) lists the four standard names: `indexes`, `defaults`, `constraints`, `expressions`. Namespaced annotations (`!com.example.x`) are preserved verbatim.

### `IcfSchema`
| Member | Description |
|---|---|
| `getRoot(): SchemaNode` | Synthetic unnamed root whose children are the top-level nodes. |
| `getTopLevelNodes(): Map<string, SchemaNode>` | Ordered. |
| `getTopLevelNode(name): SchemaNode \| undefined` | |
| `isEmpty(): boolean` | |

### `IcfSchemas` — keyed collection (spec §7 multi-schema)
The anonymous schema (bare `@schema`) is stored under `IcfSchemas.DEFAULT_ID` (`""`).

| Member | Description |
|---|---|
| `isEmpty()` / `size` | |
| `ids(): string[]` | All schema ids in declaration order. |
| `has(id): boolean` | |
| `get(id): IcfSchema \| null` | A nullish id maps to `DEFAULT_ID`. |
| `getDefault(): IcfSchema \| null` | Anonymous if present, else the first added. |
| `asMap(): Map<string, IcfSchema>` | Ordered. |
| `add(id, schema): IcfSchema` | Stores and returns the schema. |
| `getOrCreate(id): IcfSchema` | Returns the schema, creating an empty one if absent. |
| `static DEFAULT_ID` | `""`. |

---

## 9. `IcfMetadata` — the `@`-directives

Ordered map of `name → value` (no leading `@`). Section markers (`@schema`, `@data`, `@record`, `@masters`, `@metadata`) are **not** stored here.

| Method | Description |
|---|---|
| `put(name, value)` / `get(name)` / `has(name)` / `remove(name)` | |
| `asMap(): Map<string,string>` | All `@directives`, ordered. |
| `putUserMetadata(name, value)` / `getUserMetadata(name)` | The `@metadata` user section (spec §5). |
| `hasUserMetadata(name?)` | With a name → key check; without → "any entries?". |
| `userMetadataAsMap(): Map<string,string>` | Ordered. |
| `getKind()` | `@kind` (`"icf"`/`"icx"`); the writer defaults emitted output to `@kind icf`. |
| `getRecords(): string \| null` / `getRecordsAsInt(): number \| null` | `@records`. |
| `getVersion()` / `getEncoding()` / `getSpecification()` | |
| `getSchemaUrl()` / `getNamespace()` / `getVendor()` / `getGenerator()` | |
| `getCreated()` / `getModified()` / `getRevision()` / `getChecksum()` | |
| `getHashMethod()` | `@hashmethod`. `null` when absent (default `DEFAULT_HASH_METHOD = "sha256"`). |
| `getIndex()` | `@index` (associated ICX filename). |
| `getSource()` / `getSourceRevision()` / `getSourceChecksum()` / `getSourceFileChecksum()` | ICX-only directives. |
| `getDelimiterChar(): string` | Resolves `@delimiter` (`comma`/`tab`/`semicolon`/`pipe`/`space`/single char). Defaults to `,`. |
| `getEscapeChar(): string` | Resolves `@escape` (`backslash`/single char). Defaults to `\`. |
| `static resolveDelimiter(value)` / `resolveEscape(value)` | Standalone resolvers. |

Constants: `DEFAULT_DELIMITER = ','`, `DEFAULT_ESCAPE = '\\'`, `DEFAULT_HASH_METHOD = 'sha256'`.

---

## 10. Validation

### `ValidationResult`
`isValid()`, `hasWarnings()`, `getMessages()`, `getErrors()`, `getWarnings()`.

### `ValidationMessage`
`severity: Severity`, `code: string`, `message: string`, `line: number` (1-based, or `0`). Getters `getSeverity()`/`getCode()`/`getMessage()`/`getLine()`, plus `toString()`.

### `Severity`
Enum: `ERROR`, `WARNING`.

### `IcfValidator`
`validate(text): ValidationResult` (the class behind the `validate` facade).

#### Common diagnostic codes
`NO_SCHEMA`, `EMPTY_SCHEMA`, `STRAY_LINE`, `TAB_INDENT`, `UNEXPECTED_SCHEMA_LINE`, `FIELD_LIST_WITHOUT_OWNER`, `DUPLICATE_FIELD_LIST`, `DUPLICATE_NODE`, `EMPTY_NODE_NAME`, `UNCLOSED_FIELD_LIST`, `UNEXPECTED_DATA_LINE`, `ROW_WITHOUT_OWNER`, `ROW_ON_CONTAINER`, `CHILD_IN_COLLECTION`, `UNKNOWN_NODE`, `MULTIPLE_ROWS_FOR_OBJECT`, `FIELD_COUNT_MISMATCH`, `IMPLICIT_RECORD`, `ATTRIBUTE_WITHOUT_VALUE`, `MASTERS_BEFORE_SCHEMA`, `UNKNOWN_MASTER_TYPE`, `ROW_WITHOUT_MASTER_TYPE`, `UNEXPECTED_MASTERS_LINE`, `UNEXPECTED_METADATA_LINE`, `EMPTY_METADATA_KEY`, `DUPLICATE_SCHEMA_ID`, `UNKNOWN_SCHEMA_ID`, `UNCLOSED_TEXT_BLOCK`, `TEXT_BLOCK_WITHOUT_OWNER`, `UNSUPPORTED_MAJOR_VERSION`, `HIGHER_MINOR_VERSION`, `UNRESOLVED_MASTER_REFERENCE`, `MISSING_SCHEMA_FIELDS`.

Since 1.2.2 (tri-library reconciliation via the official [conformance suite](https://github.com/icformat/icf-conformance)): `DUPLICATE_SCHEMA_ID` is a **warning** (later blocks merge into the same schema); an undeclared data node draws `UNKNOWN_NODE` as an **error** but keeps its data under an ephemeral schema node; and a row bound to a schema node with no declared field list draws `MISSING_SCHEMA_FIELDS` (ERROR) while storing values under positional keys (`field1`…). Masters with no schema node at all keep the silent positional fallback.

`UNRESOLVED_MASTER_REFERENCE` (WARNING) is emitted when a row value of the form `Type:Id` — in a record **or** in a master row (a master-to-master foreign key, spec §13) — names a declared master `Type` but no matching record exists. Values whose prefix is not a declared master type (URLs, emails, timestamps) are never flagged. Inside a record, a `Type` named by the record's `primary=` attribute resolves record-locally first (spec v1.1 §45) and suppresses the master warning.

#### v1.1 diagnostic codes

| Code | Severity | Trigger |
|---|---|---|
| `RESERVED_OBJECT_NAME` | WARNING | Schema object named like a reserved directive (all document kinds — ICF §9, ICX §4; legacy ICX `index[]` warns). |
| `UNKNOWN_ANNOTATION` | WARNING | Non-namespaced, non-standard `!annotation` name. |
| `ANNOTATION_WITHOUT_OWNER` | ERROR | `!x:` in `@schema` with no enclosing object. |
| `ANNOTATION_AFTER_CHILDREN` | WARNING | Annotation after child objects (§22 ordering). |
| `MALFORMED_ANNOTATION_ENTRY` | WARNING | Standard-annotation entry missing its `=` / `:` shape. |
| `ROW_ANNOTATION_WITHOUT_ROW` | ERROR | `!x:` in data/masters with no preceding row. |
| `PRIMARY_OBJECT_NOT_FOUND` | WARNING | `primary=` names an object absent from the record. |
| `UNRESOLVED_PRIMARY_REFERENCE` | WARNING | Primary-typed reference that doesn't resolve. |
| `REQUIRED_FIELD_MISSING` | WARNING | `required` constraint violated. |
| `UNIQUE_CONSTRAINT_VIOLATION` | WARNING | `unique` constraint violated (2nd+ occurrence). |
| `UNKNOWN_CONSTRAINT` | WARNING | Constraint keyword other than `required`/`unique`. |
| `WRONG_ROW_MARKER` | WARNING | `-` on a singleton / `=` on a collection row (§41–§42). |
| `COMPACT_COLLECTION_SYNTAX` | WARNING | Compact object syntax on a collection (§43). |

---

## 11. Writer customization

### `IcfWriter`
| Member | Description |
|---|---|
| `new IcfWriter(options?: WriterOptions \| Partial<WriterOptions>)` | |
| `writeToString(target: IcfDocument \| IcfNode): string` | Infers a schema for built nodes. |
| `writeToStringWithChecksum(target, checksum: string \| null): string` | Writes with a precomputed `@checksum` (or `null` to drop a stored value without emitting one). Used by the async facade. |
| `toDocument(target): IcfDocument` | Resolves a target to a document, inferring a schema for built nodes. |
| `recordBody(doc, record): string` | Canonical body text of one record (for ICX record checksums). |
| `masterRow(doc, type, entry): string` | Canonical row text of one master entry (for ICX master checksums). |

### `WriterOptions`
A JS-idiomatic class: public fields, fluent setters (`setIndentWidth`, `setNewline`, `setScalarArrayField`, `setTextBlocksEnabled`, `setTextBlockTag`, `setComputeChecksum`), `WriterOptions.defaults()`, and `WriterOptions.from(partial)`.

| Field | Default | Description |
|---|---|---|
| `indentWidth` | `2` | |
| `newline` | `"\n"` | |
| `scalarArrayField` | `"value"` | Synthesized field name for collections of scalars (ICF has no scalar arrays). |
| `textBlocksEnabled` | `true` | When true, single-value rows whose value contains a newline are emitted as preformatted text blocks (spec §18) instead of escaped-`\n` rows. |
| `textBlockTag` | `"TEXT"` | Tag used in emitted text blocks; falls back to the escaped form if the value already contains a `TAG>>` collision. |
| `computeChecksum` | `false` | Intent flag; checksum computation is async and driven by the `writeWithChecksum` facade. |

### `canonicalContentBytes(doc): Uint8Array`
Canonical content for checksums (spec §19): re-serializes with default options and slices from the line that is exactly `@schema` or starts with `@schema ` (so `@schema-url` is excluded). UTF-8 encoded.

### `findMasterTypeSchema(schemas, typeName): SchemaNode | null`
Finds the schema node describing a master type — the writer's mirror of the parser lookup. Resolution order: legacy `masters:` container first, then top-level collections, then a depth-first search for a descendant declared under a grouping/wrapper node (nested master tables, e.g. `masterindextables:` containing `m0000002:` …).

### `SchemaInference`
| Member | Description |
|---|---|
| `new SchemaInference(scalarArrayField: string)` | |
| `infer(recordRoot: IcfNode): IcfSchema` | Throws `IcfWriteError` on shapes ICF can't represent (mixed objects, mixed-type collections, row values that are containers). |

### `IcxGenerator`
| Member | Description |
|---|---|
| `new IcxGenerator()` | Stateless; safe to share. |
| `generate(source, sourceFileName?): IcfDocument` | Structure only; empty positional/checksum fields. |
| `generateWithChecksums(source, options?: IcxChecksumOptions): Promise<IcfDocument>` | Computes checksums (and positions when `sourceText` is supplied). |
| `static INDEX_FIELDS` | `['RecordID','UUID','Line','Offset','Size','Checksum']`. |
| `static SCHEMA_ATTRIBUTE` / `RECORD_TYPE_ATTRIBUTE` / `DEFAULT_ICX_VERSION` | `"schema"` / `"type"` / `"1.2"`. |
| `static TAGS_FIELD` / `SUMMARY_FIELD` / `SUMMARY_ATTRIBUTE` | `"Tags"` / `"Summary"` / `"summary"` (ICX v1.2). |

All types (masters and record types alike) are emitted as top-level collections in a single anonymous schema. Record indexes are grouped by record type, chosen as: the `schema=` attribute, then `type=`, then the first data field name, then `"record"`. `@kind icx` and an explicit `@records` (master rows + source records) are set automatically. If the resolved `@hashmethod` is unregistered, computed fields are left empty (generation never throws).

---

## 12. Checksums (`Checksums` + named exports)

Self-describing checksum strings (`"<method>:<hex>"`), backed by a process-wide registry. `compute` **always returns a Promise**. `sha256` and `crc32` are built in; `md5`, `crc32c`, `xxh3` are reserved names that need a registered provider in the browser.

| Member | Description |
|---|---|
| `register(method: string, fn: HashFunction): void` | Registers/replaces a method (case-insensitive). Throws on a blank name or non-function. |
| `unregister(method: string): boolean` | Removes a method; returns whether one was removed. |
| `supportedMethods(): string[]` | Registered (computable) method names, sorted. |
| `isSupported(method: string): boolean` | True when registered (and thus computable). |
| `isRecognized(method: string): boolean` | True when registered **or** a reserved spec name. |
| `compute(method: string, data: Uint8Array): Promise<string>` | `"<method>:<hex>"` over `data`. Rejects when unregistered. |

`HashFunction`: `(data: Uint8Array) => Uint8Array | Promise<Uint8Array>` — returns raw digest bytes; `compute` hex-encodes them and prepends the method name.

Constants: `SHA256`, `CRC32` (built in); `MD5`, `CRC32C`, `XXH3` (reserved); `BUILT_IN`, `RESERVED`. All are available both as named exports and as members of the `Checksums` object.

```ts
import { Checksums } from 'icf.js';
Checksums.register('crc32c', (data) => myCrc32c(data)); // returns digest bytes
await Checksums.compute('crc32c', payload); // -> "crc32c:...."  (IcxGenerator now computes it too)
```

---

## 13. Lower-level parser API

### `IcfParser`
| Member | Description |
|---|---|
| `parse(text: string): ParseResult` | Resilient: always returns a best-effort document plus every diagnostic. Strips a leading BOM. |
| `static SUPPORTED_MAJOR_VERSION` / `SUPPORTED_MINOR_VERSION` | `1` / `0`. Higher major → `UNSUPPORTED_MAJOR_VERSION` error; higher minor → `HIGHER_MINOR_VERSION` warning (spec §23). |

### `ParseResult`
`getDocument(): IcfDocument`, `getMessages(): ValidationMessage[]`.

### `IcfEscaper` (static helpers)
| Method | Description |
|---|---|
| `splitAndUnescape(raw, delimiter, escape): string[]` | Splits on unescaped delimiters and unescapes + trims each cell. |
| `splitRaw(raw, delimiter, escape): string[]` | Splits only; cells retain escape sequences. |
| `unescape(field, escape): string` | Resolves `\n \t \r` and `\<char>`. |
| `escape(value, delimiter, escape): string` | Conservative (names / field lists): includes `[ ] : = @ #`. |
| `escapeValue(value, delimiter, escape): string` | Minimal (row values): delimiter, escape, `\n \t \r`. |
| `escapeAttribute(value, escape): string` | Record attributes: whitespace + escape (not `=`). |

---

## 14. Errors

All extend the native `Error`.

| Class | Thrown when |
|---|---|
| `IcfError` (base) | — |
| `IcfParseError extends IcfError` | `parse(...)` is called on text with error-level diagnostics. Carries `messages: ReadonlyArray<ValidationMessage>`. |
| `IcfWriteError extends IcfError` | The writer is given a structure ICF cannot represent (mixed object, mixed-type collection, container row value). |

---

## ICF semantics worth knowing

- **Untyped values.** ICF v1 stores everything as text. `put('qty', 100)` becomes `"100"`; parsed numbers are also strings.
- **`null` vs empty.** A bare `null` literal → `IcfNull`; an empty cell → `IcfString("")`. Distinct.
- **Escaping is context-sensitive.** Row values escape only the delimiter, escape char, and `\n \t \r`, so `Vendor:VEN001` and `vendor@example.com` round-trip verbatim. Names / field-list entries also escape `[ ] : = @ #`. Record-attribute values escape whitespace via `\<space>` (not `=`). See the three `IcfEscaper` methods.
- **Collections.** `Name[]:` → `IcfArray` of `IcfObject` rows. ICF has no scalar array — scalar arrays you build are written using a synthesized single field (`WriterOptions.scalarArrayField`).
- **Mixed objects.** An object cannot hold both scalar fields and child objects/arrays at the same level; the writer rejects this with `IcfWriteError`. Wrap the scalar fields in their own child object.
- **Record attributes** (spec §11) — `@record id=D001 note=South\ Zone`. Reserved: `id`, `uuid`, `created`, `modified`, `revision`, `schema`.
- **`@metadata` section** (spec §5) — appears before the first `@schema`; arbitrary `key: value` entries (colon syntax). Accessed via `IcfMetadata.userMetadataAsMap()`.
- **Multiple schemas** (spec §7) — records pick one via `@record schema=...`; records without it use the default schema.
- **Preformatted text blocks** (spec §18) — `<<TAG` opens a verbatim region ending at `TAG>>` at the same indent. Reserved characters carry no meaning inside. The block fills a leaf's only field; the parser strips the opening tag's indentation, the writer re-applies it.
- **Master data** (spec §13) — `Type:Id` references stay as plain strings; `IcfMasters.resolveReference(...)` resolves them on demand, whether the reference sits in a record field or in **another master's field** (master-to-master foreign keys). Unresolvable references to a declared master type surface as a non-fatal `UNRESOLVED_MASTER_REFERENCE` warning. Three schema styles all work: the legacy `masters:` container, top-level collections, and **nested master tables** (a type declared under any grouping/wrapper node, e.g. `masterindextables:` → `m0000002:`); the parser/writer resolve a master type to the first schema descendant of that name.
- **Row markers** (spec §9/§12) — `=` for single-row objects, `-` for collection rows; the writer picks by `SchemaNode.isCollection()`.
- **Compact Object Syntax** (spec §12) — `Vendor:VEN001, ABC, City` ≡ `Vendor:` + `= VEN001, ABC, City`. No whitespace before the colon; the name part contains no whitespace.
- **UTF-8 BOM** (spec §24) — a leading U+FEFF is silently stripped on parse.
- **Version compatibility** (spec §23) — supports ICF 1.0. Higher major → error; higher minor → warning + continue.
- **ICX shared `index[]` schema** (ICX §5) — when a `@masters`/`@data` type isn't declared, the parser falls back to a top-level `index` / `index[]` declaration and reuses its fields.
- **`@kind` / `@records`** — the writer emits `@kind` first (default `"icf"`) and auto-computes `@records` from the record count unless the metadata carries an explicit value.
