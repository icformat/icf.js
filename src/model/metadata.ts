/**
 * `@`-directives plus the optional user `@metadata` section.
 *
 * Mirrors icfj's `IcfMetadata`. Section markers (`@schema`, `@data`,
 * `@record`, `@masters`, `@metadata`) are *not* stored here — only directive
 * `name → value` pairs (without the leading `@`).
 */

export class IcfMetadata {
  /** Default field delimiter. */
  static readonly DEFAULT_DELIMITER = ',';
  /** Default escape character. */
  static readonly DEFAULT_ESCAPE = '\\';
  /** Default checksum algorithm. */
  static readonly DEFAULT_HASH_METHOD = 'sha256';

  private readonly directives = new Map<string, string>();
  private readonly userMetadata = new Map<string, string>();

  // ---- directives -------------------------------------------------------

  put(name: string, value: string): void {
    this.directives.set(name, value);
  }

  get(name: string): string | null {
    return this.directives.get(name) ?? null;
  }

  has(name: string): boolean {
    return this.directives.has(name);
  }

  remove(name: string): void {
    this.directives.delete(name);
  }

  /** All `@directives`, in insertion order. */
  asMap(): Map<string, string> {
    return new Map(this.directives);
  }

  // ---- user @metadata section ------------------------------------------

  putUserMetadata(name: string, value: string): void {
    this.userMetadata.set(name, value);
  }

  getUserMetadata(name: string): string | null {
    return this.userMetadata.get(name) ?? null;
  }

  hasUserMetadata(name?: string): boolean {
    return name === undefined ? this.userMetadata.size > 0 : this.userMetadata.has(name);
  }

  /** All `@metadata` entries, in insertion order. */
  userMetadataAsMap(): Map<string, string> {
    return new Map(this.userMetadata);
  }

  // ---- typed accessors --------------------------------------------------

  getKind(): string | null {
    return this.get('kind');
  }
  getVersion(): string | null {
    return this.get('version');
  }
  getEncoding(): string | null {
    return this.get('encoding');
  }
  getSpecification(): string | null {
    return this.get('specification');
  }
  getSchemaUrl(): string | null {
    return this.get('schema-url');
  }
  getNamespace(): string | null {
    return this.get('namespace');
  }
  getVendor(): string | null {
    return this.get('vendor');
  }
  getGenerator(): string | null {
    return this.get('generator');
  }
  getCreated(): string | null {
    return this.get('created');
  }
  getModified(): string | null {
    return this.get('modified');
  }
  getRevision(): string | null {
    return this.get('revision');
  }
  getChecksum(): string | null {
    return this.get('checksum');
  }
  getHashMethod(): string | null {
    return this.get('hashmethod');
  }
  getIndex(): string | null {
    return this.get('index');
  }
  /** Raw `@records` value (count as a string). */
  getRecords(): string | null {
    return this.get('records');
  }
  /** `@records` parsed as an integer, or `null` when absent / non-numeric. */
  getRecordsAsInt(): number | null {
    const raw = this.getRecords();
    if (raw === null) return null;
    const n = Number.parseInt(raw.trim(), 10);
    return Number.isNaN(n) ? null : n;
  }

  // ICX-only directives
  getSource(): string | null {
    return this.get('source');
  }
  getSourceRevision(): string | null {
    return this.get('sourcerevision');
  }
  getSourceChecksum(): string | null {
    return this.get('sourcechecksum');
  }
  getSourceFileChecksum(): string | null {
    return this.get('sourcefilechecksum');
  }

  // ---- delimiter / escape resolution -----------------------------------

  getDelimiterChar(): string {
    return IcfMetadata.resolveDelimiter(this.get('delimiter'));
  }

  getEscapeChar(): string {
    return IcfMetadata.resolveEscape(this.get('escape'));
  }

  /** Resolves `@delimiter` (`comma`, `tab`, …, or a single char) to a char. */
  static resolveDelimiter(value: string | null): string {
    if (value === null) return IcfMetadata.DEFAULT_DELIMITER;
    const v = value.trim().toLowerCase();
    switch (v) {
      case 'comma':
        return ',';
      case 'tab':
        return '\t';
      case 'semicolon':
        return ';';
      case 'pipe':
        return '|';
      case 'space':
        return ' ';
      default:
        return value.length >= 1 ? value[0]! : IcfMetadata.DEFAULT_DELIMITER;
    }
  }

  /** Resolves `@escape` (`backslash`, or a single char) to a char. */
  static resolveEscape(value: string | null): string {
    if (value === null) return IcfMetadata.DEFAULT_ESCAPE;
    const v = value.trim().toLowerCase();
    if (v === 'backslash') return '\\';
    return value.length >= 1 ? value[0]! : IcfMetadata.DEFAULT_ESCAPE;
  }
}
