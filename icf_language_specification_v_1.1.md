# Indent Comma Format (ICF) Language Specification

**Version:** 1.1

**Status:** Stable

**Category:** Standards Track

**Authors**

* Edison Williams

**Copyright**

Copyright © 2026 Edison Williams.

**License**

This specification is licensed under the Creative Commons Attribution 4.0 International (CC BY 4.0) License.

Implementations may freely read, write, validate, generate and process ICF documents for both commercial and non-commercial purposes in accordance with the license terms.

---

# Revision History

| Version | Date       | Description                                                                                                                                                                          |
| ------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1.0     | 2026-05-31 | Initial public specification                                                                                                                                                         |
| 1.1     | 2026-06-27 | Added schema annotations, row annotations, primary objects, expressions, normative processing model, abstract data model, EBNF grammar, conformance suite and editorial improvements |

---

# Table of Contents

1. Introduction
2. Applications
3. Design Goals
4. Design Principles
5. Terminology
6. File Properties
7. Overall Document Structure

Subsequent parts of this specification define the complete language.

---

# 1. Introduction

The **Indent Comma Format (ICF)** is a compact, schema-driven, hierarchical data interchange language designed for storing and exchanging structured information.

ICF combines:

* the compactness of CSV,
* the readability of YAML,
* the hierarchical organization of JSON and XML,
* and the streaming efficiency of line-oriented formats.

Unlike general-purpose serialization languages, ICF assumes that data conforms to one or more predefined schemas. Field names are declared once within a schema and subsequent records store values positionally, significantly reducing repetition and improving both readability and storage efficiency.

ICF is designed to be:

* Human-readable
* Machine-readable
* Easy to parse
* Easy to validate
* Efficient to stream
* Efficient to edit
* Efficient for AI processing
* Suitable for long-term archival

The language is intended primarily for structured business data and is particularly well suited to applications where large collections of records share a common schema.

Examples include:

* Document Management Systems (DMS)
* Enterprise Resource Planning (ERP)
* Customer Relationship Management (CRM)
* OCR extraction pipelines
* Artificial Intelligence datasets
* Retrieval-Augmented Generation (RAG)
* Scientific datasets
* Metadata repositories
* Digital archives
* Data interchange between heterogeneous systems

ICF defines both the syntax and semantics required to produce interoperable implementations.

---

# 2. Applications

ICF is designed for datasets in which records follow a known structure.

Typical applications include:

* Document Management Systems
* Invoice archives
* Purchase orders
* Human Resources
* Payroll systems
* Customer databases
* Product catalogs
* OCR extraction
* AI datasets
* Medical records
* Academic repositories
* Library catalogs
* Asset management
* Scientific observations
* IoT telemetry
* Manufacturing systems
* Government data interchange

ICF is especially suitable where:

* large numbers of similar records exist,
* field names are highly repetitive,
* streaming is important,
* deterministic validation is required,
* hierarchical relationships exist,
* long-term maintainability is desirable.

ICF is not intended to replace configuration languages such as YAML or general serialization languages such as JSON.

Instead, it is optimized for schema-driven interchange of repetitive structured records.

---

# 3. Design Goals

The primary design goals of ICF are:

## Human Readability

Documents should remain understandable without specialized tools.

---

## Compactness

Repeated field names should be avoided whenever practical.

---

## Schema Driven

Data structures should be explicitly defined before data appears.

---

## Hierarchical

Objects and collections should naturally represent nested business information.

---

## Streaming Friendly

Large documents should be processable without loading the complete document into memory.

---

## Deterministic

Documents should produce a single well-defined interpretation.

---

## Validation Friendly

Schemas should support validation of structure and business rules.

---

## Extensible

Future versions should introduce additional capabilities without unnecessarily breaking compatibility.

---

## Language Independent

ICF should be implementable in any programming language.

---

## Long-Term Stability

Documents should remain usable for decades with minimal migration effort.

---

# 4. Design Principles

The design of ICF follows several guiding principles.

## Explicit Structure

Schemas explicitly define document structure.

No field is interpreted by position alone without a corresponding schema.

---

## Separation of Concerns

ICF separates:

* document metadata,
* schema definitions,
* reusable master data,
* business records,
* indexing.

Each serves a distinct purpose.

---

## Minimal Grammar

ICF intentionally uses a very small set of language constructs.

Core syntax consists primarily of:

* Document Directives (`@`)
* Annotations (`!`)
* Objects (`:`)
* Singleton values (`=`)
* Collection rows (`-`)
* Schema field definitions (`[]`)
* Preformatted text blocks (`<< >>`)
* Escaping (`\`)

---

## Backward Compatibility

Minor language versions should remain backward compatible whenever practical.

Applications encountering unknown directives or annotations should ignore them unless strict validation is enabled.

---

## Extensible by Design

The language reserves two extension mechanisms:

* Document Directives (`@`)
* Annotations (`!`)

Applications may define additional namespaced directives and annotations without affecting the core language.

---

## Streaming First

The language has been designed so that records may be processed sequentially.

Implementations should not be required to load the complete document before processing individual records.

---

## Stable Semantics

Formatting differences shall not affect the meaning of a document.

Examples include:

* indentation width,
* blank lines,
* comments,
* compact versus expanded object syntax.

Provided the resulting Abstract Data Model is identical, such documents are considered semantically equivalent.

---

# 5. Terminology

The following terms are used throughout this specification.

| Term           | Definition                                                             |
| -------------- | ---------------------------------------------------------------------- |
| Document       | A complete ICF file.                                                   |
| Directive      | A document-level instruction beginning with `@`.                       |
| Annotation     | A schema-level or row-level instruction beginning with `!`.            |
| Schema         | A definition describing the structure of records.                      |
| Object         | A named hierarchical structure.                                        |
| Collection     | A repeating object declared using `[]` and represented using `-`.      |
| Singleton      | A non-repeating object represented using `=`.                          |
| Record         | A unit of business data beginning with `@record`.                      |
| Master Data    | Reusable data defined in the `@masters` section.                       |
| Primary Object | A record-local object identified using the `primary` record attribute. |
| Reference      | A typed link such as `Vendor:VEN001`.                                  |
| Expression     | A derived field definition declared using `!expressions`.              |
| Override       | A row annotation temporarily replacing one or more default values.     |
| ADM            | The Abstract Data Model produced after parsing.                        |
| ICX            | Companion index file for an ICF document.                              |

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHALL**, **SHALL NOT**, **SHOULD**, **SHOULD NOT**, **RECOMMENDED**, **MAY**, and **OPTIONAL** in this document are to be interpreted as described in RFC 2119.

---

# 6. File Properties

The recommended filename extension for ICF documents is:

```text
.icf
```

Example:

```text
employees.icf
```

ICF documents SHOULD be encoded using UTF-8 without a Byte Order Mark (BOM).

The proposed MIME type is:

```text
application/icf
```

The companion index format uses the extension:

```text
.icx
```

---

# 7. Overall Document Structure

An ICF document consists of the following logical sections.

1. Document Directives
2. Metadata
3. Schema Definitions
4. Master Data (optional)
5. Business Records
6. Optional External ICX Index

General structure:

```text
@kind icf

@version 1.1

...

@metadata

...

@schema

...

@masters

...

@data

...
```

The recommended processing order is:

```text
Document Directives

↓

Metadata

↓

Schema Definitions

↓

Master Data

↓

Business Records

↓

Validation

↓

Optional ICX Generation
```

The exact processing model is defined later in this specification.

---

# Part 2 — Document Structure

# 8. Document Directives

Document Directives define document-level properties and control the overall interpretation of an ICF document.

Every Document Directive begins with the `@` character.

General syntax:

```text
@directive [arguments]
```

Examples:

```text
@version 1.1

@encoding utf-8

@delimiter comma

@metadata

@schema id=Employee
```

Document Directives are recognized only at the document level.

Applications SHALL NOT interpret ordinary objects beginning with `@` as data objects.

Directive names are case-sensitive.

Directive arguments are separated by one or more whitespace characters.

Unless otherwise specified, directive ordering is not significant.

---

# 9. Reserved Document Directives

The following directive names are reserved by this specification.

```text
@kind
@version
@encoding
@delimiter
@escape

@namespace
@vendor
@generator

@created
@modified
@revision

@hashmethod
@checksum

@index

@metadata

@schema

@masters

@data

@record
```

Reserved directive names SHALL NOT be used as object names or collection names.

Example (discouraged):

```text
@masters

masters:
```

ICF Version 1.0 documents containing such usage remain valid for backward compatibility.

Validators SHOULD generate a warning rather than an error when processing Version 1.0 documents.

Beginning with Version 1.1, authors SHOULD avoid using reserved directive names as object or collection names.

---

# 10. User-defined Document Directives

Applications MAY define additional document directives.

User-defined directives SHALL use namespaced identifiers.

General syntax:

```text
@namespace.identifier
```

Examples:

```text
@com.docuventa.signature

@org.example.audit

@net.company.retention
```

Applications that do not recognize a user-defined directive SHALL ignore it unless strict validation mode is enabled.

Unknown directives SHALL NOT invalidate an otherwise conforming document.

---

# 11. Namespaces

Namespaces prevent naming conflicts between application-specific extensions.

Namespaces SHOULD follow reverse-domain naming conventions.

Examples:

```text
com.docuventa

org.example

net.company
```

Document directives:

```text
@com.docuventa.workflow

@org.example.signature
```

Schema annotations:

```text
!com.docuventa.retention

!org.example.validation
```

Record attributes:

```text
@record

com.docuventa.owner=Finance
```

Namespaces SHALL NOT modify the semantics of standard ICF constructs.

Applications SHALL ignore unknown namespaces unless strict validation mode is enabled.

---

# 12. Standard Document Directives

The following directives are defined by this specification.

| Directive     | Purpose                          |
| ------------- | -------------------------------- |
| `@kind`       | Document type.                   |
| `@version`    | ICF language version.            |
| `@encoding`   | Character encoding.              |
| `@delimiter`  | Field delimiter.                 |
| `@escape`     | Escape character.                |
| `@namespace`  | Default namespace.               |
| `@vendor`     | Producing application vendor.    |
| `@generator`  | Producing application.           |
| `@created`    | Document creation timestamp.     |
| `@modified`   | Document modification timestamp. |
| `@revision`   | Document revision number.        |
| `@hashmethod` | Default checksum algorithm.      |
| `@checksum`   | Document checksum.               |
| `@index`      | Associated ICX file.             |
| `@metadata`   | Begins metadata section.         |
| `@schema`     | Begins a schema definition.      |
| `@masters`    | Begins master data section.      |
| `@data`       | Begins data section.             |
| `@record`     | Begins a business record.        |

Each directive is defined in detail later in this specification.

---

# 13. Metadata

The optional `@metadata` section stores descriptive information about the document.

Metadata is intended for human-readable information and SHALL NOT alter the structural interpretation of the document.

Example:

```text
@metadata

title: Employee Payroll

description: Monthly payroll export

creator: Payroll System

department: Human Resources

company: Example Corporation
```

Metadata properties are treated as string values.

Applications MAY define additional metadata properties.

Unknown metadata properties SHALL be preserved whenever practical.

The `@metadata` section SHOULD appear immediately before the first schema definition.

---

# 14. Document Identification

Every ICF document SHOULD begin with the following directives.

```text
@kind icf

@version 1.1
```

Example:

```text
@kind icf

@version 1.1

@encoding utf-8

@delimiter comma

@escape backslash
```

The `@kind` directive identifies the document as an ICF document.

Future companion specifications may define additional kinds.

Example:

```text
@kind icx
```

for an ICX index document.

---

# 15. Document Properties

The following directives describe document properties.

## Character Encoding

```text
@encoding utf-8
```

UTF-8 without a Byte Order Mark (BOM) is RECOMMENDED.

---

## Field Delimiter

```text
@delimiter comma
```

The default delimiter is:

```text
comma
```

Future versions MAY define additional standard delimiters.

---

## Escape Character

```text
@escape backslash
```

The default escape character is the backslash (`\`).

Applications MAY support additional escape mechanisms provided the resulting document remains conformant.

---

# 16. Document Lifecycle

ICF provides optional directives describing the lifecycle of the document.

Example:

```text
@created 2026-06-27T08:30:00Z

@modified 2026-06-28T12:10:00Z

@revision 3
```

These directives describe the document itself rather than individual records.

Record lifecycle information is stored using Record Attributes.

---

# 17. External Index

The optional `@index` directive identifies the companion ICX document.

Example:

```text
@index payroll.icx
```

The referenced ICX document contains indexing information such as:

* record offsets
* record sizes
* checksums
* source revision

The ICX specification defines the structure of the companion index document.

---

# 18. Indentation Rules

ICF uses indentation to represent hierarchy.

Two spaces per indentation level are RECOMMENDED.

Tabs SHOULD NOT be used.

The hierarchy of a document is determined solely by indentation.

Rules:

* Child objects SHALL be indented more deeply than their parent.
* Sibling objects SHALL use identical indentation.
* Empty lines MAY appear freely outside preformatted text blocks.
* Mixed indentation SHOULD generate a validation warning.
* Indentation SHALL NOT alter the semantics of singleton or collection values.

Within every `@record`, the object hierarchy SHALL structurally mirror the hierarchy declared by the referenced schema.

---

# Part 3 — Schema Language

# 19. Schema Definitions

The `@schema` directive defines the structure of records stored within an ICF document.

A schema describes:

* object hierarchy,
* field definitions,
* schema annotations,
* relationships between objects.

General syntax:

```text
@schema id=SchemaName
```

Example:

```text
@schema id=Employee

employee:

  [empid, empname]
```

Each schema SHALL have a unique identifier within the document.

Multiple schemas MAY appear in the same ICF document.

Each `@record` SHALL reference exactly one schema.

Example:

```text
@record id=1001 schema=Employee
```

Schema identifiers are case-sensitive.

---

# 20. Objects

Objects are the fundamental structural building blocks of an ICF schema.

Every object has:

* a name,
* exactly one field definition,
* zero or more annotations,
* zero or more child objects.

Objects are hierarchical.

General syntax:

```text
ObjectName:

  ...
```

Objects preserve declaration order.

---

# 21. Object Types

ICF defines two object types.

## Singleton Objects

A Singleton Object represents exactly one logical object.

Example:

```text
employee:

  [empid, empname]
```

Its data representation uses the `=` row marker.

---

## Collection Objects

A Collection Object represents zero or more objects having identical structure.

Collections are declared by appending `[]` to the object name.

Example:

```text
employees[]:

  [empid, empname]
```

Its data representation uses the `-` row marker.

Apart from multiplicity, Collection Objects behave identically to Singleton Objects.

---

# 22. Object Structure

Every object consists of the following components in order.

1. Field Definition
2. Schema Annotations
3. Child Objects

Example:

```text
employee:

  [empid, empname]

  !indexes:

    = empid

  !defaults:

    = status=Active

  address:

    [street, city]

  salary[]:

    [month, amount]
```

Field definitions SHALL appear before annotations.

Annotations SHALL appear before child objects.

Child objects preserve declaration order.

---

# 23. Field Definitions

Field definitions describe the positional layout of data values.

General syntax:

```text
[field1, field2, field3]
```

Example:

```text
employee:

  [empid, empname, phone]
```

Rules:

* Every object SHALL contain exactly one field definition.
* Field names SHALL be unique within the object.
* Field names are case-sensitive.
* Field order SHALL be preserved.
* Square brackets SHALL be used only for schema field definitions.

---

# 24. Hierarchical Schemas

Objects MAY contain child objects.

Example:

```text
employee:

  [empid, empname]

  address:

    [street, city]
```

Objects MAY also contain Collection Objects.

Example:

```text
employee:

  [empid, empname]

  salary[]:

    [month, amount]
```

Every `@record` SHALL reproduce the hierarchy declared by its schema.

Additional objects SHALL NOT appear within records.

Required schema objects SHALL NOT be omitted.

---

# 25. Schema Annotations

Schema Annotations provide semantic information associated with an object.

Annotations begin with `!`.

General syntax:

```text
!annotation:

  ...
```

Annotations apply only to the immediately enclosing object.

Annotations SHALL NOT modify document hierarchy.

Applications MAY define additional annotations using namespaced identifiers.

Unknown annotations SHALL be ignored unless strict validation mode is enabled.

---

# 26. Standard Schema Annotations

Version 1.1 defines the following standard annotations.

| Annotation     | Purpose                   |
| -------------- | ------------------------- |
| `!indexes`     | Logical indexes           |
| `!defaults`    | Default values            |
| `!constraints` | Validation rules          |
| `!expressions` | Derived field expressions |

Future versions MAY introduce additional standard annotations.

---

# 27. Index Annotations

The `!indexes` annotation specifies logical indexes for the enclosing object.

Example:

```text
employee:

  [empid, empname]

  !indexes:

    = empid
```

Composite indexes MAY be declared.

Example:

```text
!indexes:

  = department+empid
```

Indexes are advisory metadata.

They SHALL NOT affect stored data.

---

# 28. Default Value Annotations

The `!defaults` annotation specifies default values for fields belonging to the enclosing object.

Example:

```text
employee:

  [empid, empname]

  !defaults:

    = empstatus=employed,
      idstatus=issued
```

Defaults apply to every data row belonging to the object unless explicitly overridden.

Defaults SHALL NOT change the schema.

---

# 29. Constraint Annotations

The `!constraints` annotation specifies validation rules.

Example:

```text
employee:

  [empid, empemail]

  !constraints:

    = empid:unique,
      empemail:required
```

Version 1.1 standardizes:

* `unique`
* `required`

Applications MAY define additional constraint keywords.

---

# 30. Expression Annotations

The `!expressions` annotation specifies derived field expressions.

Example:

```text
empsalary[]:

  [basic, da, hra, ta, lta, total]

  !expressions:

    = da=basic*0.25,
      hra=basic*0.15,
      total=basic+da+hra+ta+lta
```

Expressions describe relationships between fields.

Implementations MAY:

* evaluate expressions,
* validate stored values,
* ignore expressions.

Expression evaluation is OPTIONAL.

---

# 31. Annotation Scope

Annotations apply only to the enclosing object.

Example:

```text
employee:

  [empid, empname]

  !defaults:

    = status=Active

  salary[]:

    [month, amount]
```

The defaults defined for `employee` do not apply automatically to `salary`.

Each object defines its own annotation scope.

---

# 32. Schema Conformance

A schema conforms to this specification if:

* every schema has a unique identifier,
* every object has exactly one field definition,
* field names are unique,
* field ordering is preserved,
* annotations follow the field definition,
* child objects follow annotations,
* annotation scope is respected,
* the hierarchy is well formed.

Conforming implementations SHALL reject schemas violating these requirements.

---

# Part 4 — Data Model

# 33. Data Model

The data model defines how information described by a schema is represented within an ICF document.

ICF separates data into two logical categories:

* **Master Data** – reusable objects shared across records.
* **Business Records** – individual record instances defined by a schema.

Business records MAY reference master data using typed references.

The hierarchy of every business record SHALL conform to its referenced schema.

---

# 34. Master Data

The optional `@masters` section contains reusable objects that may be referenced by multiple records.

Typical master data includes:

* Employees
* Customers
* Vendors
* Projects
* Departments
* Products
* Tax Codes

General structure:

```text
@masters

...
```

Master data SHALL appear after all schema definitions and before the `@data` section.

Applications SHALL continue to function correctly when the `@masters` section is omitted.

---

# 35. Master Objects

Master objects follow the same structural rules as ordinary objects.

A master object MAY be either:

* a Singleton Object
* a Collection Object

Example:

```text
@masters

Project:

  = PRJ001,
    Chennai,
    Corporate Office

Vendor:

  - VEN001, ABC Traders
  - VEN002, XYZ Industries
```

Master objects SHALL conform to their corresponding schema definitions.

---

# 36. Business Records

The `@data` directive begins the Business Record section.

Example:

```text
@data

@record id=1001 schema=Invoice

...
```

Every business record SHALL begin with an `@record` directive.

The record continues until:

* the next `@record`, or
* the end of the `@data` section.

---

# 37. Record Directives

The `@record` directive identifies a business record.

General syntax:

```text
@record
```

Record attributes are specified as key-value pairs.

Example:

```text
@record
id=1001
schema=Invoice
revision=2
```

Each record SHALL reference exactly one schema.

---

# 38. Record Attributes

Version 1.1 defines the following standard record attributes.

| Attribute  | Purpose                      |
| ---------- | ---------------------------- |
| `id`       | Record identifier            |
| `uuid`     | Globally unique identifier   |
| `schema`   | Referenced schema            |
| `created`  | Creation timestamp           |
| `modified` | Modification timestamp       |
| `revision` | Record revision              |
| `checksum` | Optional checksum            |
| `primary`  | Record-local primary objects |

Applications MAY define additional namespaced attributes.

Unknown attributes SHALL be ignored unless strict validation mode is enabled.

---

# 39. Primary Objects

The optional `primary` attribute identifies objects that act as record-local master objects.

Example:

```text
@record
id=2
schema=Employee
primary=employee,designation
```

Primary objects are resolved before global master objects.

Primary objects affect reference resolution only.

They SHALL NOT alter document hierarchy.

---

# 40. Object Instances

Objects appearing within a record are instances of objects declared by the referenced schema.

Example:

```text
employee:

  = 2,
    Bharat,
    bharat@example.com
```

Every object instance SHALL correspond to exactly one schema object.

Objects SHALL appear in the same hierarchical position as defined by the schema.

---

# 41. Singleton Objects

Singleton Objects contain exactly one value object.

General syntax:

```text
Object:

  = value
```

Example:

```text
employee:

  = 1,
    Anand,
    9876543210
```

Singleton Objects SHALL contain exactly one value object.

---

# 42. Collection Objects

Collection Objects contain zero or more rows.

General syntax:

```text
Collection:

  - row1

  - row2
```

Example:

```text
salary:

  - Jan,
    2026,
    12000

  - Feb,
    2026,
    12500
```

Every row SHALL conform to the field definition declared by the schema.

Rows preserve declaration order.

---

# 43. Compact Object Syntax

Singleton Objects MAY be represented using compact syntax.

Example:

```text
Vendor:VEN001
```

is equivalent to

```text
Vendor:

  = VEN001
```

Likewise,

```text
Project:PRJ001,
        Chennai,
        Corporate Office
```

is equivalent to

```text
Project:

  = PRJ001,
    Chennai,
    Corporate Office
```

Compact syntax SHALL NOT be used for Collection Objects.

---

# 44. References

References associate one object with another.

General syntax:

```text
ObjectName:Identifier
```

Examples:

```text
Vendor:VEN001

Project:PRJ001

employee:2

designation:MGR01
```

References are case-sensitive.

The object name identifies the referenced object type.

---

# 45. Reference Resolution

References SHOULD be resolved using the following order.

1. Record-local Primary Objects.
2. Global Master Objects.
3. Application-defined external references.

Example:

```text
employee:2
```

is first resolved against objects declared by:

```text
primary=employee
```

Only if no local object exists should the parser search the global `@masters` section.

Applications MAY report unresolved references as warnings or errors.

---

# 46. Row Annotations

Row Annotations apply to the immediately preceding collection row.

Version 1.1 defines one standard row annotation.

```text
!overrides
```

General syntax:

```text
- ...

!overrides:

  = ...
```

Applications MAY define additional row annotations using namespaced identifiers.

---

# 47. Override Annotations

The `!overrides` annotation temporarily replaces one or more default values defined by the enclosing object.

Example:

```text
salary:

  - employee:2,
    Jan,
    2026,
    12000

  !overrides:

    = idstatus=tobeissued,
      certificates=notreceived
```

Overrides affect only the immediately preceding row.

Subsequent rows continue using the schema defaults unless another override is declared.

---

# 48. Data Conformance

A Business Record conforms to this specification if:

* it references an existing schema,
* every object appears in the position defined by the schema,
* singleton objects contain exactly one value object,
* collection rows match the schema field definition,
* references follow the standard reference syntax,
* row annotations follow the row to which they apply,
* primary objects reference existing objects within the record.

Conforming implementations SHALL reject records violating these requirements.

---

# Part 5 — Core Language Features

# 49. Character Encoding

ICF documents SHALL specify the character encoding using the `@encoding` directive.

Example:

```text
@encoding utf-8
```

UTF-8 without a Byte Order Mark (BOM) is RECOMMENDED.

Implementations MAY support additional encodings.

If an unsupported encoding is encountered, the parser SHALL report an error.

---

# 50. Field Delimiters

Field values within a row are separated by a delimiter specified using the `@delimiter` directive.

Example:

```text
@delimiter comma
```

The standard delimiter values defined by this specification are:

| Value   | Delimiter |
| ------- | --------- |
| `comma` | `,`       |

Future versions of this specification may define additional standard delimiters.

Applications MAY support implementation-specific delimiters.

---

# 51. Escape Character

Reserved characters appearing within field values SHALL be escaped using the configured escape character.

The escape character is specified using the `@escape` directive.

Example:

```text
@escape backslash
```

The default escape character is the backslash (`\`).

Example:

```text
employee:

  = 1,
    John\, Smith,
    john@example.com
```

The parsed value of the second field is:

```text
John, Smith
```

---

# 52. Reserved Characters

The following characters have reserved meaning within ICF.

| Character | Meaning                                |
| --------- | -------------------------------------- |
| `@`       | Document Directive                     |
| `!`       | Annotation                             |
| `:`       | Object separator / Reference separator |
| `=`       | Singleton row marker                   |
| `-`       | Collection row marker                  |
| `[` `]`   | Schema field definition                |
| `,`       | Field delimiter                        |
| `\`       | Escape character                       |
| `#`       | Comment                                |
| `<<` `>>` | Preformatted text delimiters           |

Reserved characters SHALL be escaped when used as literal data unless contained within a preformatted text block.

---

# 53. Empty Values

An empty field is represented by two consecutive delimiters.

Example:

```text
employee:

  = 1,
    Anand,
    ,
    anand@example.com
```

In this example, the third field is an empty string.

Empty values SHALL preserve their position within the row.

---

# 54. Null Values

ICF does not define a standard null literal.

Applications MAY adopt a convention appropriate for their domain.

Common examples include:

```text
null
```

or

```text
NULL
```

The interpretation of null values is application-defined.

---

# 55. Comments

Comment lines begin with the configured comment character.

The default comment character is:

```text
#
```

Example:

```text
# Employee Master Data
```

Comments MAY appear between directives, objects and records.

Comments SHALL NOT appear inside preformatted text blocks.

Applications MAY preserve or discard comments during processing.

Comments SHALL NOT affect the semantics of an ICF document.

---

# 56. Empty Lines

Empty lines MAY be inserted freely to improve readability.

Empty lines have no semantic meaning except inside preformatted text blocks.

Multiple consecutive empty lines are permitted.

Implementations SHOULD preserve empty lines whenever practical.

---

# 57. Preformatted Text

ICF supports preformatted text blocks for storing text exactly as written.

Preformatted text preserves:

* indentation,
* whitespace,
* reserved characters,
* comment characters,
* blank lines,
* line endings.

Characters contained within a preformatted text block SHALL NOT be interpreted by the parser.

General syntax:

```text
<<IDENTIFIER

...

IDENTIFIER>>
```

The opening and closing identifiers SHALL:

* match exactly,
* use identical case,
* appear on separate lines,
* use identical indentation.

Example:

```text
OCRText:

<<TEXT
Invoice No : INV-001

Total Amount : ₹12,540

Approved by Accounts.

TEXT>>
```

The entire block SHALL be stored exactly as written.

Applications SHALL NOT modify the contents of a preformatted text block unless explicitly requested.

---

# 58. Whitespace

Whitespace outside preformatted text blocks is significant only where it defines hierarchy.

Leading indentation determines parent-child relationships.

Trailing whitespace outside preformatted text blocks SHOULD be ignored.

Whitespace within field values SHALL be preserved.

Whitespace within preformatted text blocks SHALL be preserved exactly.

---

# 59. Value Continuation

Long value rows MAY span multiple lines.

Continuation lines SHALL align beneath the first value.

Example:

```text
employee:

  = 1,
    Anand,
    9876543210,
    anand@example.com
```

The multiline representation is semantically identical to:

```text
employee:

  = 1, Anand, 9876543210, anand@example.com
```

Applications MAY choose either representation when writing ICF documents.

---

# 60. Compact and Expanded Forms

Several language constructs permit both compact and expanded forms.

Examples include:

Singleton object:

```text
Project:PRJ001
```

Expanded equivalent:

```text
Project:

  = PRJ001
```

Multiline values:

```text
= A,
  B,
  C
```

Single-line equivalent:

```text
= A, B, C
```

Compact and expanded forms are semantically equivalent.

Formatting differences SHALL NOT alter the meaning of an ICF document.

---

# 61. Language Equivalence

Two ICF documents are considered semantically equivalent if they produce identical Abstract Data Models (ADM).

Differences that SHALL NOT affect semantic equivalence include:

* blank lines,
* comments,
* indentation width,
* compact versus expanded syntax,
* single-line versus multiline values,
* formatting.

Applications MAY normalize formatting during export provided semantic equivalence is preserved.

---

# 62. Core Language Summary

The ICF language is defined by the following core constructs.

| Construct | Purpose                    |
| --------- | -------------------------- |
| `@`       | Document Directives        |
| `!`       | Schema and Row Annotations |
| `:`       | Objects and References     |
| `=`       | Singleton Object Values    |
| `-`       | Collection Rows            |
| `[]`      | Schema Field Definitions   |
| `<< >>`   | Preformatted Text          |
| `\`       | Escaping                   |

All language features defined by this specification are composed from these core constructs.

---

# Part 6 — Validation and Conformance

# 63. Validation

Validation verifies that an ICF document conforms to this specification and any applicable application-specific rules.

Validation MAY be performed:

* during document creation,
* during import,
* during export,
* during editing,
* as a standalone verification process.

A validator SHALL NOT modify the document being validated.

---

# 64. Validation Rules

A conforming validator SHOULD verify the following.

## Document Structure

* Valid document directives.
* Required directives are present.
* Directive ordering where required.

---

## Schema Validation

* Schema identifiers are unique.
* Object hierarchy is valid.
* Field definitions are present.
* Field names are unique within each object.
* Annotation placement is valid.

---

## Record Validation

* Every record references an existing schema.
* Record hierarchy matches the referenced schema.
* Field counts match schema definitions.
* Required objects are present.
* Collection rows conform to their schema.

---

## Reference Validation

* Typed references are syntactically valid.
* Referenced primary objects exist within the record when applicable.
* Referenced master objects exist when applicable.

---

## Annotation Validation

* Standard annotations are correctly formed.
* Standard annotations appear only in permitted locations.
* Unknown annotations generate warnings unless strict validation is enabled.

---

# 65. Constraint Validation

Implementations supporting `!constraints` SHOULD validate the declared rules.

Version 1.1 standardizes the following constraints:

* `required`
* `unique`

Applications MAY define additional constraints.

Constraint evaluation is implementation-defined.

---

# 66. Expression Validation

Implementations MAY evaluate expressions declared using `!expressions`.

Expression evaluation is OPTIONAL.

If expressions are evaluated, implementations SHOULD verify that stored values are consistent with the evaluated results.

Failure to evaluate expressions SHALL NOT invalidate an otherwise conforming document.

---

# 67. Checksums

Checksums provide optional integrity verification.

The checksum algorithm is specified using:

```text
@hashmethod
```

Example:

```text
@hashmethod sha256
```

The document checksum is specified using:

```text
@checksum
```

Example:

```text
@checksum sha256:6F4D9A...
```

Applications MAY support additional checksum algorithms.

---

# 68. Checksum Scope

Document checksums apply to the logical contents of the document.

Record checksums, when present, apply only to the corresponding record.

The exact checksum calculation algorithm is implementation-defined.

The ICX specification defines checksum usage for indexed records.

---

# 69. Revisions

ICF supports document revision tracking.

Example:

```text
@revision 5
```

The revision number SHALL be a positive integer.

Applications SHOULD increment the revision whenever the document contents change.

Record revisions are independent of document revisions and are specified using the `revision` record attribute.

---

# 70. Error Reporting

Validators SHOULD report diagnostics using one of the following severity levels.

| Severity    | Meaning                              |
| ----------- | ------------------------------------ |
| Information | Informational message.               |
| Warning     | Non-fatal issue.                     |
| Error       | Document violates the specification. |

Applications MAY define additional severity levels.

Validation SHOULD continue after recoverable errors whenever practical.

---

# 71. Normative Processing Model

A conforming implementation SHOULD process an ICF document using the following logical sequence.

## Phase 1 — Parse Document

1. Read document directives.
2. Determine encoding.
3. Determine delimiter.
4. Determine escape character.
5. Read metadata.

---

## Phase 2 — Parse Schemas

1. Parse schema definitions.
2. Parse field definitions.
3. Parse schema annotations.
4. Build schema hierarchy.

---

## Phase 3 — Parse Master Data

1. Read master objects.
2. Build master lookup tables.

---

## Phase 4 — Parse Business Records

For each record:

1. Read the `@record` directive.
2. Read record attributes.
3. Locate the referenced schema.
4. Parse object instances.
5. Parse collection rows.
6. Associate row annotations with the immediately preceding row.

---

## Phase 5 — Resolve Data

1. Apply schema defaults.
2. Resolve primary object references.
3. Resolve master references.
4. Apply row overrides.
5. Optionally evaluate expressions.

---

## Phase 6 — Validate

Validate:

* hierarchy,
* references,
* constraints,
* field counts,
* checksums,
* expressions (optional).

---

## Phase 7 — Finalize

Applications MAY:

* generate an ICX document,
* verify an existing ICX document,
* export to other formats.

Equivalent processing models are permitted provided they produce identical observable results.

---

# 72. Conformance

An implementation conforms to this specification if it:

* correctly parses all mandatory language constructs,
* preserves document hierarchy,
* correctly interprets directives,
* correctly interprets annotations,
* preserves semantic equivalence,
* produces an equivalent Abstract Data Model.

Implementations MAY support additional features provided they do not alter the semantics of standard ICF documents.

---

# 73. Parser Recommendations

Parser implementations SHOULD:

* support streaming,
* avoid loading the complete document when unnecessary,
* preserve declaration order,
* preserve comments whenever practical,
* preserve unknown directives,
* preserve unknown annotations,
* support strict and permissive validation modes.

These recommendations improve interoperability but are not mandatory for conformance.

---

# 74. Version Compatibility

Minor versions of ICF are intended to remain backward compatible.

Version 1.1 implementations SHOULD accept Version 1.0 documents.

Unknown directives, annotations and attributes SHOULD be ignored unless strict validation mode is enabled.

Future major versions MAY introduce incompatible language changes.

---

# 75. Standard Directives

The following document directives are standardized by Version 1.1.

```text
@kind
@version
@encoding
@delimiter
@escape

@namespace
@vendor
@generator

@created
@modified
@revision

@hashmethod
@checksum

@index

@metadata

@schema

@masters

@data

@record
```

Applications SHALL NOT redefine standard directive names.

---

# 76. Standard Annotations

Version 1.1 standardizes the following schema annotations.

```text
!indexes
!defaults
!constraints
!expressions
```

Version 1.1 standardizes the following row annotation.

```text
!overrides
```

Applications SHALL NOT redefine standard annotation names.

User-defined annotations SHOULD use namespaced identifiers.

---

# 77. Future Extensions

ICF has been designed to support future extensions without altering its core grammar.

Future versions MAY introduce:

* additional directives,
* additional schema annotations,
* additional row annotations,
* additional validation rules,
* additional standardized constraint types,
* additional standardized expression capabilities.

Applications SHOULD ignore unknown language features unless strict validation mode is enabled.

---

# 78. License

This specification is released under the **Creative Commons Attribution 4.0 International (CC BY 4.0)** license.

Commercial and non-commercial use, implementation, distribution and modification are permitted under the terms of the license.

---

# 79. Acknowledgements

The Indent Comma Format (ICF) was conceived and designed by **Edison Williams**.

The reference implementations and tools developed around the language contribute to the continued evolution and adoption of the ICF ecosystem.

---

# Part 7 — Appendices

# Appendix A — Formal Grammar (EBNF)

This appendix defines the normative grammar of the Indent Comma Format (ICF).

ICF is an indentation-sensitive language.

Implementations SHALL first tokenize indentation into the following lexical tokens:

* `INDENT`
* `DEDENT`
* `NEWLINE`

The grammar below assumes these tokens have already been generated.

---

## A.1 Lexical Elements

```ebnf
Identifier ::= Letter { Letter | Digit | "_" | "-" | "." }

Directive ::= "@" Identifier

Annotation ::= "!" Identifier

ObjectName ::= Identifier

SchemaId ::= Identifier

RecordId ::= Identifier

Attribute ::= Identifier "=" Value

Reference ::= ObjectName ":" Identifier
```

---

## A.2 Document

```ebnf
Document ::=

    Directives

    Metadata?

    Schema+

    Masters?

    Data
```

---

## A.3 Directives

```ebnf
Directives ::= { DirectiveStatement }

DirectiveStatement ::=

    Directive

    { Attribute }

    NEWLINE
```

---

## A.4 Metadata

```ebnf
Metadata ::=

    "@metadata"

    NEWLINE

    INDENT

        { MetadataEntry }

    DEDENT
```

---

## A.5 Schema

```ebnf
Schema ::=

    "@schema"

    Attribute

    NEWLINE

    INDENT

        Object

    DEDENT
```

---

## A.6 Objects

```ebnf
Object ::=

    SingletonObject

  | CollectionObject
```

---

## A.7 Singleton Object

```ebnf
SingletonObject ::=

    ObjectName

    ":"

    NEWLINE

    INDENT

        FieldDefinition

        Annotation*

        Object*

    DEDENT
```

---

## A.8 Collection Object

```ebnf
CollectionObject ::=

    ObjectName

    "[]"

    ":"

    NEWLINE

    INDENT

        FieldDefinition

        Annotation*

        Object*

    DEDENT
```

---

## A.9 Field Definition

```ebnf
FieldDefinition ::=

    "["

        Identifier

        { "," Identifier }

    "]"

    NEWLINE
```

---

## A.10 Annotation

```ebnf
Annotation ::=

    AnnotationName

    ":"

    NEWLINE

    INDENT

        AnnotationValue

    DEDENT
```

---

## A.11 Masters

```ebnf
Masters ::=

    "@masters"

    NEWLINE

    INDENT

        DataObject*

    DEDENT
```

---

## A.12 Data

```ebnf
Data ::=

    "@data"

    NEWLINE

    INDENT

        Record*

    DEDENT
```

---

## A.13 Record

```ebnf
Record ::=

    "@record"

    Attribute*

    NEWLINE

    INDENT

        DataObject*

    DEDENT
```

---

## A.14 Data Objects

```ebnf
DataObject ::=

    SingletonValue

  | CollectionValues
```

---

## A.15 Singleton Values

```ebnf
SingletonValue ::=

    ObjectName

    ":"

    NEWLINE

    INDENT

        "="

        ValueList

    DEDENT
```

---

## A.16 Collection Values

```ebnf
CollectionValues ::=

    ObjectName

    ":"

    NEWLINE

    INDENT

        CollectionRow*

    DEDENT
```

---

## A.17 Collection Row

```ebnf
CollectionRow ::=

    "-"

    ValueList

    NEWLINE

    RowAnnotation*
```

---

## A.18 Row Annotation

```ebnf
RowAnnotation ::=

    "!overrides"

    ":"

    NEWLINE

    INDENT

        "="

        AssignmentList

    DEDENT
```

---

## A.19 Compact Syntax

```ebnf
CompactObject ::=

    ObjectName

    ":"

    ValueList
```

is equivalent to

```ebnf
ObjectName

":"

NEWLINE

INDENT

"="

ValueList

DEDENT
```

---

## A.20 Text Blocks

```ebnf
TextBlock ::=

    "<<"

    Identifier

    NEWLINE

    Text

    Identifier

    ">>"
```

The opening and closing identifiers SHALL match exactly.

---

# Appendix B — Abstract Data Model

The Abstract Data Model (ADM) defines the logical structure produced by parsing an ICF document.

The ADM is independent of:

* formatting,
* indentation width,
* comments,
* blank lines,
* compact versus expanded syntax.

Two ICF documents are semantically equivalent if they produce identical Abstract Data Models.

---

## B.1 Document

```
Document
│
├── Directives
├── Metadata
├── Schemas
├── Masters
├── Records
└── ICX Reference (optional)
```

---

## B.2 Schema

```
Schema
│
├── Identifier
└── Root Object
```

---

## B.3 Object

```
Object
│
├── Name
├── Type
├── Fields
├── Annotations
└── Children
```

Object Type is one of:

* Singleton
* Collection

---

## B.4 Fields

```
Field
│
├── Name
└── Position
```

Field ordering is preserved.

---

## B.5 Annotations

```
Annotation
│
├── Name
└── Values
```

Annotations describe semantics only.

They do not affect hierarchy.

---

## B.6 Record

```
Record
│
├── Attributes
└── Objects
```

Standard attributes include:

* id
* uuid
* schema
* created
* modified
* revision
* checksum
* primary

---

## B.7 Singleton Objects

```
Singleton Object
│
└── Values
```

Exactly one value object.

---

## B.8 Collection Objects

```
Collection Object
│
└── Rows
```

Zero or more rows.

Rows preserve declaration order.

---

## B.9 Row

```
Row
│
├── Values
└── Row Annotations
```

---

## B.10 References

```
Reference
│
├── Object Type
└── Identifier
```

Example:

```
Vendor:VEN001
```

becomes

```
Reference

Object Type = Vendor

Identifier = VEN001
```

---

## B.11 Expressions

```
Expression
│
├── Target Field
└── Expression
```

Expressions are metadata associated with schema objects.

Evaluation is implementation-defined.

---

## B.12 Text Blocks

```
Text Block
│
├── Identifier
└── Content
```

Content is preserved exactly as written.

---

## B.13 Semantic Equivalence

Two ICF documents are semantically equivalent if they produce identical Abstract Data Models.

Differences in:

* whitespace,
* comments,
* formatting,
* indentation width,
* compact versus expanded syntax,
* line wrapping,

SHALL NOT affect semantic equivalence.

---

## B.14 Relationship to ICX

The ICX document is not part of the Abstract Data Model.

It is a companion index describing the physical layout of the corresponding ICF document.

---

