/**
 * The output of {@link IcfParser.parse}: a best-effort document plus every
 * diagnostic. Mirrors icfj's `ParseResult`.
 */

import type { IcfDocument } from '../document.js';
import type { ValidationMessage } from '../validation.js';

export class ParseResult {
  constructor(
    private readonly document: IcfDocument,
    private readonly messages: ValidationMessage[],
  ) {}

  getDocument(): IcfDocument {
    return this.document;
  }

  getMessages(): ValidationMessage[] {
    return [...this.messages];
  }
}
