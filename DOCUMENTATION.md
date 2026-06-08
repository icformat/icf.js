# icf.js — Public API

Zero-dependency **browser** library to parse, validate, build, write, and index **Indent Comma Format (ICF)** text, and generate **ICX** companion indexes. A faithful behavioral port of the Java library [`icfj`](https://github.com/icformat/icfj).

- **Package:** `icf.js` (ESM + IIFE global `window.ICF`)
- **Runtime:** modern browsers / Node ≥ 20 (needs Web Crypto for `sha256`)
- **Encoding:** UTF-8. A leading BOM is stripped on parse. Inputs and outputs are **strings** (no file/stream I/O).

> This file is the canonical reference for the public API, kept in sync with the source by hand. Any change that adds, renames, or removes an exported member must be reflected here in the same change. See `CLAUDE.md` for the maintenance rule.

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
| `toIcfNode(): IcfNode` | One record → its object; otherwise an array of records. |
| `getRecordsAsArray(): IcfArray` | Always an array, regardless of record count. |
| `toJsonString(): string` / `toPrettyString(): string` | JSON of the data. |

Constructor: `new IcfDocument(metadata, schema | schemas, masters, records)` — accepts either a single `IcfSchema` (wrapped under the default id) or an `IcfSchemas`.

---

## 6. `IcfRecord`

| Method | Description |
|---|---|
| `getData(): IcfObject` | Record body as a native object. |
| `getAttributes(): Map<string,string>` | Attributes from the `@record` line, in declaration order. |
| `getAttribute(name): string \| null` | |
| `getId()` / `getUuid()` / `getCreated()` / `getModified()` / `getRevision()` | Reserved-attribute shorthands (spec §11). |
| `getSchemaId(): string \| null` | The `schema=` attribute, or `null` (record uses the default schema). |

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
| `resolveReference(reference): IcfObject \| null` | Parses `"Type:Id"` and returns the entry. |
| `static MASTERS_NODE_NAME` | The reserved schema container name (`"masters"`). |

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
`NO_SCHEMA`, `EMPTY_SCHEMA`, `STRAY_LINE`, `TAB_INDENT`, `UNEXPECTED_SCHEMA_LINE`, `FIELD_LIST_WITHOUT_OWNER`, `DUPLICATE_FIELD_LIST`, `DUPLICATE_NODE`, `EMPTY_NODE_NAME`, `UNCLOSED_FIELD_LIST`, `UNEXPECTED_DATA_LINE`, `ROW_WITHOUT_OWNER`, `ROW_ON_CONTAINER`, `CHILD_IN_COLLECTION`, `UNKNOWN_NODE`, `MULTIPLE_ROWS_FOR_OBJECT`, `FIELD_COUNT_MISMATCH`, `IMPLICIT_RECORD`, `ATTRIBUTE_WITHOUT_VALUE`, `MASTERS_BEFORE_SCHEMA`, `UNKNOWN_MASTER_TYPE`, `ROW_WITHOUT_MASTER_TYPE`, `UNEXPECTED_MASTERS_LINE`, `UNEXPECTED_METADATA_LINE`, `EMPTY_METADATA_KEY`, `DUPLICATE_SCHEMA_ID`, `UNKNOWN_SCHEMA_ID`, `UNCLOSED_TEXT_BLOCK`, `TEXT_BLOCK_WITHOUT_OWNER`, `UNSUPPORTED_MAJOR_VERSION`, `HIGHER_MINOR_VERSION`.

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
Finds the schema node describing a master type (legacy `masters:` container first, then top-level collections) — the writer's mirror of the parser lookup.

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
| `static SCHEMA_ATTRIBUTE` / `RECORD_TYPE_ATTRIBUTE` / `DEFAULT_ICX_VERSION` | `"schema"` / `"type"` / `"1.0"`. |

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
- **Master data** (spec §13) — `Type:Id` references stay as plain strings; `IcfMasters.resolveReference(...)` resolves them on demand. Two schema styles (legacy `masters:` container, new top-level collections) both work.
- **Row markers** (spec §9/§12) — `=` for single-row objects, `-` for collection rows; the writer picks by `SchemaNode.isCollection()`.
- **Compact Object Syntax** (spec §12) — `Vendor:VEN001, ABC, City` ≡ `Vendor:` + `= VEN001, ABC, City`. No whitespace before the colon; the name part contains no whitespace.
- **UTF-8 BOM** (spec §24) — a leading U+FEFF is silently stripped on parse.
- **Version compatibility** (spec §23) — supports ICF 1.0. Higher major → error; higher minor → warning + continue.
- **ICX shared `index[]` schema** (ICX §5) — when a `@masters`/`@data` type isn't declared, the parser falls back to a top-level `index` / `index[]` declaration and reuses its fields.
- **`@kind` / `@records`** — the writer emits `@kind` first (default `"icf"`) and auto-computes `@records` from the record count unless the metadata carries an explicit value.
