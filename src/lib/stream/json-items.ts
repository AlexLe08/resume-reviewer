/**
 * Pulls complete objects out of one array in a JSON document while it is still
 * streaming in. For `{"results":[{…},{…}` it yields each `{…}` as soon as its
 * closing brace arrives.
 *
 * Why not a general partial-JSON parser? We only ever need whole array items.
 * A general parser would also hand us half-written strings, which would
 * flicker on screen and arrive before they can be validated. Whole items can
 * be checked against the schema one at a time.
 */
export function createArrayItemReader(key: string) {
  const opener = new RegExp(`"${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\s*:\\s*\\[`);
  let buffer = '';
  let scanFrom = -1; // -1 until the array has started
  let depth = 0; // nesting inside the array; 0 = between items
  let itemStart = -1;
  let inString = false;
  let escaped = false;
  let finished = false;

  return {
    push(chunk: string): unknown[] {
      buffer += chunk;
      const items: unknown[] = [];
      if (finished) return items;

      if (scanFrom === -1) {
        const match = opener.exec(buffer);
        if (!match) return items;
        scanFrom = match.index + match[0].length;
      }

      for (let i = scanFrom; i < buffer.length; i++) {
        const ch = buffer[i];
        if (inString) {
          if (escaped) escaped = false;
          else if (ch === '\\') escaped = true;
          else if (ch === '"') inString = false;
          continue;
        }
        if (ch === '"') {
          inString = true;
        } else if (ch === '{' || ch === '[') {
          if (depth === 0 && ch === '{') itemStart = i;
          depth++;
        } else if (ch === '}' || ch === ']') {
          if (depth === 0) {
            finished = true; // the array itself closed
            scanFrom = i + 1;
            return items;
          }
          depth--;
          if (depth === 0 && ch === '}' && itemStart !== -1) {
            try {
              items.push(JSON.parse(buffer.slice(itemStart, i + 1)));
            } catch {
              // Malformed item: skip it. Final validation of the whole document still applies.
            }
            itemStart = -1;
          }
        }
      }
      scanFrom = buffer.length;
      return items;
    },
  };
}
