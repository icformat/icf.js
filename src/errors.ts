/**
 * Exception hierarchy for icf.js. All errors extend the native {@link Error}.
 *
 * Mirrors icfj's `IcfException` / `IcfParseException` / `IcfWriteException`.
 */

import type { ValidationMessage } from './validation.js';

/** Base class for every error raised by the library. */
export class IcfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IcfError';
    // Restore prototype chain for transpiled targets.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown by {@link parse} when the input contains error-level diagnostics.
 * Carries every accumulated {@link ValidationMessage} via {@link messages}.
 */
export class IcfParseError extends IcfError {
  readonly messages: ReadonlyArray<ValidationMessage>;

  constructor(message: string, messages: ReadonlyArray<ValidationMessage> = []) {
    super(message);
    this.name = 'IcfParseError';
    this.messages = messages;
  }
}

/**
 * Thrown by the writer when given a structure ICF cannot represent — e.g. an
 * object mixing scalar fields with child objects/arrays, a mixed-type
 * collection, or a row value that is itself a container.
 */
export class IcfWriteError extends IcfError {
  constructor(message: string) {
    super(message);
    this.name = 'IcfWriteError';
  }
}
