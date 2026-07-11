# Indent Comma Index Format (ICX) Specification

**Version:** 1.2

**Status:** Stable

**Category:** Standards Track

**Authors**

* Edison Williams

**Copyright**

Copyright © 2026 Edison Williams.

**License**

This specification is licensed under the Creative Commons Attribution 4.0 International (CC BY 4.0) License.

---

# Revision History

| Version | Date       | Description                                                                                                                                                                    |
| ------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1.0     | 2026-05-31 | Initial public specification                                                                                                                                                   |
| 1.1     | 2026-07-11 | Aligned ICX with ICF language policies: ICF indentation rules and the reserved directive name rule now apply; the shared index structure is renamed `recordindex[]`; examples corrected; editorial improvements |
| 1.2     | 2026-07-11 | Added the optional `Tags` and `Summary` index fields, the `tagindex[]` and `summaryindex[]` alternative structures, the `@sourcebytes` directive, and harness-oriented usage guidance |

---

# 1. Introduction

Indent Comma Index Format (ICX) is an optional companion format to ICF.

An ICX file contains indexing and optimization metadata for records stored in an ICF file.

ICX is designed to support:

* Random record access
* Fast record lookup
* Record integrity verification
* Synchronization
* Incremental processing
* Large ICF archives

ICX contains only index information and does not store business data.

---

# 2. File Properties

Recommended extension:

```text
.icx
```

Example:

```text
invoice_archive.icx
```

The `.icx` extension is recommended but not required.

The proposed MIME type is:

```text
application/icx
```

UTF-8 without BOM is recommended.

---

# 3. Relationship to ICF

An ICF file may reference an ICX file using:

```text
@index invoice_archive.icx
```

The referenced ICX file contains indexing information for records contained within the ICF document.

ICX files are optional.

Applications MUST continue to function when an ICX file is absent.

---

# 4. Alignment with the ICF Language

**Every ICX document is a conforming ICF document** whose `@kind` is `icx`. ICX defines no syntax of its own — it reuses the ICF language and therefore inherits ICF's language policies. In particular:

## Indentation Rules

ICX documents SHALL follow the ICF indentation rules (ICF v1.1 §18):

* Hierarchy is determined solely by indentation.
* Two spaces per indentation level are RECOMMENDED; tabs SHOULD NOT be used.
* Document directives (`@schema`, `@masters`, `@data`, …) are **not** containers. Top-level objects following a directive begin at column 0; only child content of an *object* is indented more deeply than its parent object.
* Sibling objects use identical indentation.

Version 1.0 of this specification showed index type declarations indented beneath the `@masters` / `@data` directives. Beginning with Version 1.1, examples and documents SHOULD place type declarations at column 0. Existing v1.0 documents remain readable; the extra indentation carries no meaning.

## Reserved Directive Names

ICX documents SHALL follow the ICF reserved directive name rule (ICF v1.1 §9): reserved directive names (`kind`, `version`, `index`, `schema`, `masters`, `data`, `record`, …) SHALL NOT be used as object or collection names.

Version 1.0 of this specification used a shared structure named `index[]`. Because `index` is a reserved directive name, **Version 1.1 renames the shared structure to `recordindex[]`**.

ICX Version 1.0 documents containing `index[]` remain valid for backward compatibility. Validators SHOULD generate a warning rather than an error when processing such documents. Beginning with Version 1.1, authors SHALL use `recordindex[]`.

## Row Markers, Escaping and Text Rules

Collection rows use the `-` marker; singleton values use `=` (ICF v1.1 §41–§42). Escaping, empty values, comments and whitespace semantics are exactly those of ICF.

---

# 5. Metadata Directives

Metadata directives begin with `@`.

## Supported Directives

| Directive   | Meaning                                     |
| ----------- | ------------------------------------------- |
| `@kind icx` | First line of ICX file                      |
| `@version`  | ICX specification version                   |
| `@created`  | Index creation timestamp                    |
| `@modified` | Last index modification timestamp           |
| `@revision` | Index revision number                       |
| `@source`   | Associated ICF file                         |
| `@sourcerevision` | ICF revision number of file from which ICX was generated |
| `@checksum` | File integrity checksum                     |
| `@sourcechecksum` | Content checksum of ICF file, excluding ICF metadata. Same value as `checksum` in ICF file |
| `@sourcefilechecksum` | Full file checksum of ICF including ICF metadata |
| `@sourcebytes` | Total size of the ICF source file in bytes (staleness check for offsets) |
| `@hashmethod` | Optional checksum algorithm. Default is sha256. Other options are md5 and crc32. Libraries will have an extension point to add custom hash methods like crc32c and xxh3. Use same hash method, if specified in ICF |
| `@records`  | Record count (Only @data, not @masters)     |
| `@schema`   | Beginning of schema definition              |
| `@masters`  | Beginning of master data index definitions  |
| `@data`     | Beginning of regular data index definitions |

Example:

```text
@kind icx
@version 1.2
@created 2026-05-28T14:22:10Z
@modified 2026-05-29T10:15:42Z
@revision 3
@source invoice_archive.icf
@sourcerevision 5
@checksum sha256:ICX_CONTENT_HASH
@sourcechecksum sha256:ICF_CONTENT_HASH
@sourcefilechecksum sha256:ICF_FILE_HASH
@sourcebytes 48213
@records 250
```

---

# 6. Index Schema

Every index collection uses the same six core fields, plus two OPTIONAL
fields introduced in Version 1.2:

| Field    | Since | Meaning              |
| -------- | ----- | -------------------- |
| RecordID | 1.0   | Record identifier    |
| UUID     | 1.0   | Record UUID          |
| Line     | 1.0   | Starting line number |
| Offset   | 1.0   | Starting byte offset |
| Size     | 1.0   | Record size in bytes |
| Checksum | 1.0   | Record checksum      |
| Tags     | 1.2   | OPTIONAL — search keywords for the record (see §7) |
| Summary  | 1.2   | OPTIONAL — one-line synopsis of the record (see §8) |

Index documents MAY declare only the six core fields (fully backward
compatible), or the seven- or eight-field form. When declared, the optional
fields MAY be empty in any row.

Two schema styles are conforming.

## Shared Index Structure (compact)

A single shared collection describes the structure used by every index type:

```text
@schema

recordindex[]:
  [RecordID, UUID, Line, Offset, Size, Checksum, Tags, Summary]
```

Index types appearing in `@masters` and `@data` that are not declared elsewhere implicitly use the `recordindex[]` structure.

> **Backward compatibility:** ICX 1.0 named this shared structure `index[]`. Processors SHOULD continue to accept `index[]` in `@version 1.0` documents; validators SHOULD report its reserved name as a warning, not an error (see §4).

## Per-Type Index Declarations (explicit)

Each index type may instead be declared as its own top-level collection:

```text
@schema

Vendor[]:
  [RecordID, UUID, Line, Offset, Size, Checksum]

Project[]:
  [RecordID, UUID, Line, Offset, Size, Checksum]

Invoice[]:
  [RecordID, UUID, Line, Offset, Size, Checksum]
```

This is the form reference generators emit. Both styles produce the same Abstract Data Model.

---

# 7. Record Tags

The OPTIONAL `Tags` field carries search keywords for an index row, so that
applications — AI harnesses in particular — can locate relevant ICF records
from the index alone and then read only those records by `Offset`/`Size`.

## Syntax

Multiple tags within the single `Tags` cell are joined with the plus sign:

```text
Project:ICF+Folder:C:\\Claude\\ICF
```

(The doubled backslashes are ordinary ICF value escaping — the escape
character itself must be escaped; colons need no escaping in values.)

* The join character is `+`. A literal `+` inside a tag SHALL be escaped
  with the document escape character (`\+`).
* Tags are ordered and MAY repeat types; consumers SHOULD de-duplicate.
* An empty cell means the record has no tags.

## Typed Reference Tags

Tags SHOULD be **typed master references** (`MasterType:MasterID`, ICF v1.1
§44) rather than bare keywords. A typed tag:

* records *which kind* of thing it names,
* resolves against the ICX document's own `@masters` index rows via the
  standard reference resolution (the master index row's first field is the
  master ID),
* is therefore checked by ordinary referential-integrity validation.

Validators SHALL evaluate the tags of a joined cell **individually**: in a
`@kind icx` document, a field value containing an unescaped `+` is split
per this section before reference checking, so a multi-tag cell is never
mistaken for one long reference.

Bare keyword tags are permitted; they are opaque to validators.

## Generator Behavior

Index generators SHOULD harvest tags automatically from the source ICF
record: every field value that is a typed reference to a declared master
type becomes a tag. Applications MAY supply additional tags.

---

# 8. Record Summaries

The OPTIONAL `Summary` field carries a one-line, human- and
machine-readable synopsis of the record.

* Content is application-defined free text (normal ICF value escaping).
* Generators MAY take the summary from a record attribute named `summary`
  in the source ICF, or from an application-supplied provider.
* An empty cell means no summary is available.

Together, `Tags` and `Summary` let a consumer triage an entire archive from
the index alone: filter rows by tag, read summaries, then fetch only the
winning records from the ICF by byte range.

---

# 9. Inverted Index Structures

As an alternative (or complement) to the per-row `Tags` and `Summary`
fields, an ICX document MAY carry dedicated top-level collections in
`@data`:

```text
@schema

tagindex[]:
  [Tag, RecordIDs]

summaryindex[]:
  [RecordID, Summary]
```

```text
@data

tagindex:
  - Project:ICF, Prompt1+Prompt3
  - Project:Struo, Prompt2

summaryindex:
  - Prompt1, Setup notes for the ICF workspace
  - Prompt2, Struo build pipeline discussion
```

* `tagindex[]` maps one tag to the record identifiers carrying it —
  `RecordIDs` uses the same `+` join as `Tags` (§7).
* `summaryindex[]` maps one record identifier to its summary.
* Both structures are ordinary ICF collections: no new syntax is required
  and standard parsers read them unchanged.
* Producers MAY emit the per-row fields, the inverted structures, or both;
  when both are present they SHALL be consistent.

---

# 10. Index Data

Master indexes appear in `@masters`; data record indexes appear in `@data`. Type declarations begin at column 0; rows are indented one level (two spaces) and use the `-` collection marker:

```text
@masters

Vendor:
  - VEN001, 550e8400-e29b-41d4-a716-446655440000, 25, 285, 120, sha256:ABC123
  - VEN002, 550e8400-e29b-41d4-a716-446655440001, 30, 405, 118, sha256:ABC124

Project:
  - PRJ001, 550e8400-e29b-41d4-a716-446655440002, 40, 620, 85, sha256:DEF456

@data

Invoice:
  - INV001, 550e8400-e29b-41d4-a716-446655440003, 80, 1400, 420, sha256:GHI789
  - INV002, 550e8400-e29b-41d4-a716-446655440004, 95, 1820, 398, sha256:GHI790
```

---

# 11. Checksum Semantics

The checksum algorithm is governed by `@hashmethod` and values carry a `method:` prefix.

Example:

```text
@checksum sha256:6F4D9A...
```

The default method is `sha256`.

Checksums are calculated from the corresponding ICF record contents.

For regular records:

* Record body is included.
* `@record` directive is excluded.
* Record attributes are excluded.

For master records:

* Master data row contents are included.
* Structural directives are excluded.

Checksums should be calculated using:

* UTF-8 encoding
* LF line endings
* Canonical field ordering

---

# 12. Line and Offset Semantics

Line numbers and byte offsets are advisory indexing information.

Applications must not rely on them for correctness.

If the associated ICF file is modified, the ICX file should be regenerated.

---

# 13. Revision Semantics

The `@revision` value shall be a positive integer.

The revision number should increase whenever:

* Records are added
* Records are removed
* Record locations change
* Checksums change
* Master data changes
* Index metadata changes

---

# 14. Version Compatibility

ICX minor versions are intended to remain backward compatible.

Version 1.2 is purely additive: the `Tags` and `Summary` fields, the
`tagindex[]`/`summaryindex[]` structures and `@sourcebytes` are all
OPTIONAL. Version 1.1 documents are valid Version 1.2 documents.

Version 1.2 processors SHOULD accept Version 1.0 documents, including the legacy `index[]` shared structure and directive-indented type declarations, reporting at most warnings.

The `@version` of an ICX document is the **ICX specification version**, not
the ICF language version; ICF language processors SHALL NOT apply the ICF
version gate to `@kind icx` documents.

Documents SHOULD declare the ICX version they target:

```text
@version 1.2
```

---

# 15. Harness Usage (Informative)

The intended random-access flow for applications and AI harnesses:

1. Read the (small) ICX file once.
2. Verify freshness: compare `@sourcebytes` / `@sourcefilechecksum`
   against the ICF file; regenerate the index when stale (§12).
3. Filter index rows by `Tags`, or look tags up in `tagindex[]`.
4. Triage candidates by `Summary` without opening the ICF.
5. Read only the selected records from the ICF using `Offset` and `Size`
   (byte-range reads), verifying each with `Checksum`.
6. For incremental synchronization, cache derived artifacts (summaries,
   embeddings) keyed by `RecordID` + `Checksum` — only records whose
   checksum changed need re-processing.

---

# 16. Example Full ICX File

```text
@kind icx

@version 1.2
@created 2026-05-20T08:30:00Z
@modified 2026-05-25T14:45:00Z
@revision 3
@source dms_export.icf
@sourcerevision 5
@sourcebytes 48213

@records 3

@schema

recordindex[]:
  [RecordID, UUID, Line, Offset, Size, Checksum, Tags, Summary]

@masters

Vendor:
  - VEN100, , 53, 1120, 58, sha256:VEND100HASH
  - VEN501, , 56, 1185, 59, sha256:VEND501HASH
  - VEN800, , 59, 1250, 59, sha256:VEND800HASH

Project:
  - PRJ001, , 63, 1340, 62, sha256:PROJ001HASH
  - PRJ005, , 66, 1410, 56, sha256:PROJ005HASH
  - PRJ010, , 69, 1470, 59, sha256:PROJ010HASH

@data

Invoice:
  - DOC1001, 550e8400-e29b-41d4-a716-446655440001, 75, 1600, 980, sha256:DOC1001HASH, Vendor:VEN100+Project:PRJ001, Cement supply invoice for May
  - DOC2001, 550e8400-e29b-41d4-a716-446655440002, 110, 2580, 920, sha256:DOC2001HASH, Vendor:VEN501+Project:PRJ005, Steel rods purchase order
  - DOC3001, 550e8400-e29b-41d4-a716-446655440003, 145, 3500, 870, sha256:DOC3001HASH, Vendor:VEN800+Project:PRJ010, Electrical fittings invoice
```

---

# 17. License

This specification is released under the **Creative Commons Attribution 4.0 International (CC BY 4.0)** license.

Commercial and non-commercial use, implementation, distribution and modification are permitted under the terms of the license.
