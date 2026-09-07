/**
 * Split a command line into words the way a POSIX shell does, so
 * `cbonsai -m "grow, little tree"` arrives as one argument. Whitespace
 * separates words; '…' is literal; "…" keeps spaces and honours \" \\ \$ \`;
 * a bare backslash escapes the next character. An unterminated quote runs
 * to the end of the line.
 */
export function tokenize(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inWord = false;
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (ch === "'") {
      inWord = true;
      i++;
      while (i < line.length && line[i] !== "'") cur += line[i++];
      i++;
      continue;
    }
    if (ch === '"') {
      inWord = true;
      i++;
      while (i < line.length && line[i] !== '"') {
        if (line[i] === "\\" && i + 1 < line.length && '"\\$`'.includes(line[i + 1])) {
          cur += line[i + 1];
          i += 2;
        } else {
          cur += line[i++];
        }
      }
      i++;
      continue;
    }
    if (ch === "\\") {
      inWord = true;
      if (i + 1 < line.length) {
        cur += line[i + 1];
        i += 2;
      } else {
        i++;
      }
      continue;
    }
    if (/\s/.test(ch)) {
      if (inWord) {
        out.push(cur);
        cur = "";
        inWord = false;
      }
      i++;
      continue;
    }
    cur += ch;
    inWord = true;
    i++;
  }
  if (inWord) out.push(cur);
  return out;
}
