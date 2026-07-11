# Indent Comma Index Format (ICX) Specification

**Version:** 1.1

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
| `@hashmethod` | Optional checksum algorithm. Default is sha256. Other options are md5 and crc32. Libraries will have an extension point to add custom hash methods like crc32c and xxh3. Use same hash method, if specified in ICF |
| `@records`  | Record count (Only @data, not @masters)     |
| `@schema`   | Beginning of schema definition              |
| `@masters`  | Beginning of master data index definitions  |
| `@data`     | Beginning of regular data index definitions |

Example:

```text
@kind icx
@version 1.1
@created 2026-05-28T14:22:10Z
@modified 2026-05-29T10:15:42Z
@revision 3
@source invoice_archive.icf
@sourcerevision 5
@checksum sha256:ICX_CONTENT_HASH
@sourcechecksum sha256:ICF_CONTENT_HASH
@sourcefilechecksum sha256:ICF_FILE_HASH
@records 250
```

---

# 6. Index Schema

Every index collection uses the same six fields:

| Field    | Meaning              |
| -------- | -------------------- |
| RecordID | Record identifier    |
| UUID     | Record UUID          |
| Line     | Starting line number |
| Offset   | Starting byte offset |
| Size     | Record size in bytes |
| Checksum | Record checksum      |

Two schema styles are conforming.

## Shared Index Structure (compact)

A single shared collection describes the structure used by every index type:

```text
@schema

recordindex[]:
  [RecordID, UUID, Line, Offset, Size, Checksum]
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

# 7. Index Data

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

# 8. Checksum Semantics

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

# 9. Line and Offset Semantics

Line numbers and byte offsets are advisory indexing information.

Applications must not rely on them for correctness.

If the associated ICF file is modified, the ICX file should be regenerated.

---

# 10. Revision Semantics

The `@revision` value shall be a positive integer.

The revision number should increase whenever:

* Records are added
* Records are removed
* Record locations change
* Checksums change
* Master data changes
* Index metadata changes

---

# 11. Version Compatibility

ICX minor versions are intended to remain backward compatible.

Version 1.1 processors SHOULD accept Version 1.0 documents, including the legacy `index[]` shared structure and directive-indented type declarations, reporting at most warnings.

Documents SHOULD declare the ICX version they target:

```text
@version 1.1
```

---

# 12. Example Full ICX File

```text
@kind icx

@version 1.1
@created 2026-05-20T08:30:00Z
@modified 2026-05-25T14:45:00Z
@revision 3
@source dms_export.icf
@sourcerevision 5

@records 3

@schema

recordindex[]:
  [RecordID, UUID, Line, Offset, Size, Checksum]

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
  - DOC1001, 550e8400-e29b-41d4-a716-446655440001, 75, 1600, 980, sha256:DOC1001HASH
  - DOC2001, 550e8400-e29b-41d4-a716-446655440002, 110, 2580, 920, sha256:DOC2001HASH
  - DOC3001, 550e8400-e29b-41d4-a716-446655440003, 145, 3500, 870, sha256:DOC3001HASH
```

---

# 13. License

This specification is released under the **Creative Commons Attribution 4.0 International (CC BY 4.0)** license.

Commercial and non-commercial use, implementation, distribution and modification are permitted under the terms of the license.
