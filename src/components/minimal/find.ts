// Where Is (^F): finding a word in the page's text, as nano finds it in the file. Case-insensitive, forward from the
// last match, wrapping round to the top.

/** A match in the text: where it is, which of how many it is, and whether the search went past the end to find it. */
export interface Match {
  start: number;
  end: number;
  /** 1-based. */
  index: number;
  count: number;
  wrapped: boolean;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The first match of `query` in `text` that starts at or after `from`; past the last one, the first one. */
export function nextMatch(text: string, query: string, from: number): Match | null {
  if (!query) return null;
  const found = [...text.matchAll(new RegExp(escape(query), "giu"))].map((m) => ({ start: m.index, end: m.index + m[0].length }));
  if (!found.length) return null;
  const k = found.findIndex((m) => m.start >= from);
  const at = k === -1 ? 0 : k;
  return { ...found[at], index: at + 1, count: found.length, wrapped: k === -1 };
}

/** What nano says after a search, or "" when it says nothing: a plain find moves the cursor and that is all. */
export function said(query: string, match: Match | null): string {
  if (!match) return `[ "${query}" not found ]`;
  if (match.count === 1) return "[ This is the only occurrence ]";
  return match.wrapped ? "[ Search Wrapped ]" : "";
}

/** What a screen reader is told after a search: what the screen shows, and where the match is. */
export function spoken(query: string, match: Match | null): string {
  if (!match) return `“${query}” not found.`;
  const where = `Found “${query}”, ${match.index} of ${match.count}.`;
  return match.wrapped ? `${where} The search went back to the top.` : where;
}

/** The block a text node is read in: its line, as far as a search is concerned. */
const block = (node: Node) => node.parentElement?.closest("h1, h2, p, li, dt, dd") ?? null;

/** The text of `root` as one string, a line break between blocks, and where each text node starts in it. */
export function textOf(root: Element): { text: string; nodes: { node: Text; start: number }[] } {
  const nodes: { node: Text; start: number }[] = [];
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let text = "";
  let last: Element | null = null;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const node = n as Text;
    if (!node.data) continue;
    const here = block(node);
    if (nodes.length && here !== last) text += "\n";
    last = here;
    nodes.push({ node, start: text.length });
    text += node.data;
  }
  return { text, nodes };
}

/** The DOM range for characters `start` to `end` of textOf()'s string. */
export function rangeOf(nodes: { node: Text; start: number }[], start: number, end: number): Range | null {
  const at = (i: number) => {
    for (let k = nodes.length - 1; k >= 0; k--) {
      if (nodes[k].start <= i) return { node: nodes[k].node, offset: Math.min(i - nodes[k].start, nodes[k].node.data.length) };
    }
    return null;
  };
  const from = at(start);
  const to = at(end);
  if (!from || !to) return null;
  const range = from.node.ownerDocument.createRange();
  range.setStart(from.node, from.offset);
  range.setEnd(to.node, to.offset);
  return range;
}
