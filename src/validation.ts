/**
 * Diagnostics produced by parsing and validation.
 *
 * Mirrors icfj's `Severity`, `ValidationMessage`, `ValidationResult`,
 * `IcfValidator`. Diagnostic codes are stable / machine-readable.
 */

import { IcfParser } from './parser/parser.js';

export enum Severity {
  ERROR = 'ERROR',
  WARNING = 'WARNING',
}

/** A single diagnostic, optionally tied to a 1-based source line. */
export class ValidationMessage {
  constructor(
    readonly severity: Severity,
    readonly code: string,
    readonly message: string,
    readonly line = 0,
  ) {}

  getSeverity(): Severity {
    return this.severity;
  }
  getCode(): string {
    return this.code;
  }
  getMessage(): string {
    return this.message;
  }
  getLine(): number {
    return this.line;
  }

  toString(): string {
    const at = this.line > 0 ? ` (line ${this.line})` : '';
    return `${this.severity} ${this.code}: ${this.message}${at}`;
  }
}

/** The aggregate result of validation: messages partitioned by severity. */
export class ValidationResult {
  constructor(private readonly messages: ValidationMessage[]) {}

  /** True when there are no `ERROR`-severity messages. */
  isValid(): boolean {
    return this.getErrors().length === 0;
  }

  hasWarnings(): boolean {
    return this.getWarnings().length > 0;
  }

  getMessages(): ValidationMessage[] {
    return [...this.messages];
  }

  getErrors(): ValidationMessage[] {
    return this.messages.filter((m) => m.severity === Severity.ERROR);
  }

  getWarnings(): ValidationMessage[] {
    return this.messages.filter((m) => m.severity === Severity.WARNING);
  }
}

/** Validates ICF text, collecting every diagnostic without throwing. */
export class IcfValidator {
  validate(text: string): ValidationResult {
    const result = new IcfParser().parse(text);
    return new ValidationResult(result.getMessages());
  }
}
