/**
 * Context-sensitive escaping (spec §14).
 *
 * Mirrors icfj's `IcfEscaper`. Three escape functions, one unified unescape:
 *  - {@link escape} — conservative (names / field lists): `[ ] : = @ #` plus
 *    delimiter / escape / control characters.
 *  - {@link escapeValue} — minimal (row values): delimiter, escape, `\n \t \r`.
 *  - {@link escapeAttribute} — record attributes: whitespace + escape, but
 *    NOT `=` (the parser splits attributes on the first `=`).
 */

const NEWLINE = '\n';
const TAB = '\t';
const CR = '\r';

/** Splits on unescaped delimiters and unescapes + trims each cell. */
export function splitAndUnescape(raw: string, delimiter: string, escape: string): string[] {
  return splitRaw(raw, delimiter, escape).map((cell) => unescape(cell.trim(), escape));
}

/** Splits on unescaped delimiters only; cells retain their escape sequences. */
export function splitRaw(raw: string, delimiter: string, escape: string): string[] {
  const cells: string[] = [];
  let current = '';
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!;
    if (ch === escape && i + 1 < raw.length) {
      // keep the escape sequence verbatim
      current += ch + raw[i + 1]!;
      i++;
      continue;
    }
    if (ch === delimiter) {
      cells.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  cells.push(current);
  return cells;
}

/** Resolves `\n \t \r` and `\<char>` sequences. */
export function unescape(field: string, escape: string): string {
  let out = '';
  for (let i = 0; i < field.length; i++) {
    const ch = field[i]!;
    if (ch === escape && i + 1 < field.length) {
      const next = field[i + 1]!;
      i++;
      switch (next) {
        case 'n':
          out += NEWLINE;
          break;
        case 't':
          out += TAB;
          break;
        case 'r':
          out += CR;
          break;
        default:
          out += next;
      }
      continue;
    }
    out += ch;
  }
  return out;
}

function escapeControl(ch: string, escape: string): string | null {
  if (ch === NEWLINE) return escape + 'n';
  if (ch === TAB) return escape + 't';
  if (ch === CR) return escape + 'r';
  return null;
}

const CONSERVATIVE = new Set(['[', ']', ':', '=', '@', '#']);

/** Conservative escape for declaration names and field-list entries. */
export function escape(value: string, delimiter: string, escapeChar: string): string {
  let out = '';
  for (const ch of value) {
    const ctrl = escapeControl(ch, escapeChar);
    if (ctrl !== null) {
      out += ctrl;
    } else if (ch === escapeChar || ch === delimiter || CONSERVATIVE.has(ch)) {
      out += escapeChar + ch;
    } else {
      out += ch;
    }
  }
  return out;
}

/** Minimal escape for row values: delimiter, escape, `\n \t \r` only. */
export function escapeValue(value: string, delimiter: string, escapeChar: string): string {
  let out = '';
  for (const ch of value) {
    const ctrl = escapeControl(ch, escapeChar);
    if (ctrl !== null) {
      out += ctrl;
    } else if (ch === escapeChar || ch === delimiter) {
      out += escapeChar + ch;
    } else {
      out += ch;
    }
  }
  return out;
}

/** Escape for `@record` attribute values: whitespace + escape (not `=`). */
export function escapeAttribute(value: string, escapeChar: string): string {
  let out = '';
  for (const ch of value) {
    const ctrl = escapeControl(ch, escapeChar);
    if (ctrl !== null) {
      out += ctrl;
    } else if (ch === escapeChar) {
      out += escapeChar + escapeChar;
    } else if (ch === ' ') {
      out += escapeChar + ' ';
    } else {
      out += ch;
    }
  }
  return out;
}

/** All escaper helpers, grouped to mirror icfj's static `IcfEscaper`. */
export const IcfEscaper = {
  splitAndUnescape,
  splitRaw,
  unescape,
  escape,
  escapeValue,
  escapeAttribute,
};
