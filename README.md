# icf.js

A small, **zero-dependency browser library** to parse, validate, build, write, and index **Indent Comma Format (ICF)** text, and to generate **ICX** companion indexes.

`icf.js` is a faithful behavioral port of the Java library [`icfj`](https://github.com/icformat/icfj), adapted for the browser: inputs and outputs are plain **strings** (no file or stream I/O), and checksums are **async** (Web Crypto). It ships as ESM with bundled type declarations and as a standalone IIFE global.

- 📦 Zero runtime dependencies
- 🌳 JSON-tree-style data model with safe `path(...)` navigation
- 🧱 Schema-driven parse / write with full round-trip fidelity
- 🔐 Self-describing checksums (`sha256`, `crc32` built in; pluggable registry)
- 🗂️ ICX index generation as a normal ICF document
- 📜 ICF v1 + ICX v1 — see the [specifications](https://icformat.org)

> ICF combines the compactness of CSV, the readability of YAML, and the hierarchy of JSON — by declaring a schema once and storing records positionally. It is well suited to OCR pipelines, invoice/ERP interchange, document archives, and AI/RAG datasets.

---

## Install

```bash
npm install icf.js
```

### ESM (bundler or `<script type="module">`)

```js
import { parse, write, writeWithChecksum, generateIcx } from 'icf.js';

const doc = parse(icfText);
console.log(doc.toPrettyString());
```

### Plain `<script>` via jsDelivr (IIFE global `window.ICF`)

```html
<script src="https://cdn.jsdelivr.net/gh/icformat/icf.js@v1/dist/icf.min.js"></script>
<script>
  const doc = ICF.parse(text);
  console.log(doc.toJsonString());
</script>
```

The package also exposes `unpkg` / `jsdelivr` fields, so `https://cdn.jsdelivr.net/npm/icf.js` resolves to the minified global.

---

## Quick start

### 1. Parse and navigate

```js
import { parse } from 'icf.js';

const doc  = parse(icfText);
const data = doc.toIcfNode();

// path(...) returns a "missing" node instead of throwing, so chains are safe
const city = data.path('indexdata').path('masterindex')
                 .path('Project').path('Location').asText();

// records and attributes
const record = doc.getRecord(0);
console.log(record.getId(), record.getAttribute('note'));
```

### 2. Validate

```js
import { validate, isValid } from 'icf.js';

const result = validate(icfText);
if (!result.isValid()) {
  for (const err of result.getErrors()) console.warn(err.toString());
}

if (isValid(icfText)) { /* ... */ }
```

### 3. Build a node from scratch and write it

```js
import { IcfNode, write } from 'icf.js';

const root = IcfNode.object();
root.putObject('vendor').put('id', 'V001').put('email', 'v@example.com');
root.putArray('items').addObject().put('sku', 'A1').put('qty', 100);

const icf = write(root); // schema is inferred from the node shape
```

### 4. Generate an ICX companion index

```js
import { parse, generateIcx, write } from 'icf.js';

const doc = parse(icfText);
const icx = generateIcx(doc, 'invoice_archive.icf'); // an IcfDocument
const icxText = write(icx);                          // serialize to .icx text
```

### 5. Checksums (async)

```js
import { parse, writeWithChecksum, generateIcxWithChecksums } from 'icf.js';

const doc = parse(icfText);

// Emit a fresh @checksum over the canonical content (spec §19)
const signed = await writeWithChecksum(doc);

// Build an ICX with per-record checksums + advisory line/offset/size
const icx = await generateIcxWithChecksums(doc, {
  sourceFileName: 'invoice_archive.icf',
  sourceText: icfText,
});
// Invariant: the ICF's @checksum equals the ICX's @sourcechecksum
```

### 6. Fetch helper

```js
import { fetchIcf } from 'icf.js';

const doc = await fetchIcf('/data/invoice_archive.icf');
```

---

## A taste of ICF

```text
@kind icf
@version 1.0

@schema

documentindex:
  [InvoiceNo, InvoiceDate, VendorRef]

lineindex:

  BillItems[]:
    [SNo, Item, Quantity, Amount]

@data

@record id=DOC1001

documentindex:
  = INV-2026-001, 2026-05-01, Vendor:VEN100

lineindex:

  BillItems:
    - 1, Cement, 100, 42000
    - 2, Steel Rod, 50, 42500
```

Key ideas: a **schema** declares the shape once; **records** store values positionally; `Name[]:` marks a **collection** (rows start with `-`), a plain leaf gets a single `= row`; `Type:Id` is a **master reference**; `<<TAG ... TAG>>` stores **verbatim text blocks**. See [DOCUMENTATION.md](./DOCUMENTATION.md) for the full API and ICF semantics.

---

## API surface

`parse` · `parseLenient` · `validate` · `isValid` · `write` · `writeWithChecksum` · `generateIcx` · `generateIcxWithChecksums` · `fetchIcf`

Model: `IcfNode` (`IcfObject`, `IcfArray`, `IcfString`, `IcfNull`, `IcfMissing`) · `IcfDocument` · `IcfRecord` · `IcfMetadata` · `IcfMasters` · `IcfSchema` / `IcfSchemas` / `SchemaNode`.

Lower level: `IcfParser` · `ParseResult` · `IcfValidator` · `IcfWriter` / `WriterOptions` · `SchemaInference` · `IcxGenerator` · `IcfEscaper` · `Checksums`.

Full reference: **[DOCUMENTATION.md](./DOCUMENTATION.md)**.

---

## Browser deltas vs. `icfj`

| `icfj` (Java) | `icf.js` (browser) |
|---|---|
| `Path` / `Reader` / `InputStream` overloads | **strings only**; plus `fetchIcf(url)` |
| `sha256` / `md5` / `crc32` built in | **`sha256` + `crc32` built in**; `md5` is reserved (registry-only) alongside `crc32c` / `xxh3` |
| synchronous checksums | **async** (`writeWithChecksum`, `generateIcxWithChecksums`, `Checksums.compute`) |
| `WriterOptions` fluent builder | JS-idiomatic class: plain fields, fluent setters, `WriterOptions.from(partial)` |

Everything else — parse, build, validate, `write`, `generateIcx`, the data model, and the ICX structure — mirrors `icfj` 1:1.

---

## Development

```bash
npm install
npm test          # vitest (happy-dom)
npm run typecheck # tsc --noEmit (src + tests)
npm run build     # tsup -> dist/icf.js (ESM), dist/icf.global.js + dist/icf.min.js (IIFE), dist/index.d.ts
```

The `test/fixtures/` directory holds the four canonical fixtures; the round-trip tests (`parse → write → parse`) are the strongest correctness check. See [CLAUDE.md](./CLAUDE.md) for architecture and the spec gotchas.

---

## License

[MIT](./LICENSE) © 2026 Edison Williams.

The ICF and ICX specifications are © 2026 Edison Williams, licensed under CC BY 4.0.
