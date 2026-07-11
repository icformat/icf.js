/**
 * ICX v1.2 §7 tag-cell helpers: tags within a single `Tags` cell are joined
 * with `+`; a literal `+` or escape char inside a tag is escaped with the
 * escape character. Standalone module so both the ICX generator and the
 * parser's referential-integrity scan can use it.
 */

/** Joins tags into a `Tags` cell value (ICX v1.2 §7). */
export function joinTags(tags: string[], escapeChar = '\\'): string {
  return tags
    .map((t) => t.split(escapeChar).join(escapeChar + escapeChar).split('+').join(`${escapeChar}+`))
    .join('+');
}

/** Splits a `Tags` cell value back into tags (inverse of {@link joinTags}). */
export function splitTags(cell: string, escapeChar = '\\'): string[] {
  if (cell === '') return [];
  const tags: string[] = [];
  let current = '';
  for (let i = 0; i < cell.length; i++) {
    const ch = cell[i]!;
    if (ch === escapeChar && i + 1 < cell.length) {
      current += cell[i + 1]!;
      i++;
      continue;
    }
    if (ch === '+') {
      tags.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  tags.push(current);
  return tags;
}

/** True when `cell` contains an unescaped `+` (i.e. joins multiple tags). */
export function hasUnescapedJoin(cell: string, escapeChar = '\\'): boolean {
  for (let i = 0; i < cell.length; i++) {
    if (cell[i] === escapeChar) {
      i++;
      continue;
    }
    if (cell[i] === '+') return true;
  }
  return false;
}
