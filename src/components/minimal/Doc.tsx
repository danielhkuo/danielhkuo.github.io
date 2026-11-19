import { parse, spans, type Span } from "@/components/terminal/markdown";

/**
 * What makes printed output live: with it, the commands and file names in
 * the output are buttons. The page's own static sections are printed without
 * it, since without JavaScript such a button would do nothing.
 */
export interface Live {
  /** The name of every command this shell runs. */
  names: ReadonlySet<string>;
  /** A button for `line` was pressed: run it, or put it on the prompt for its next word. */
  press(line: string): void;
}

/**
 * A markdown file as a document: what `cat` prints on the minimal version.
 * The terminal's old window lays the same file out in rows of cells
 * (markdown.ts, after glow); here it is headings, paragraphs, lists and
 * links, so it reads in a screen reader and wraps to any width, and the
 * styles give it glow's look (minimal.css, "Files").
 *
 * The file's title is an `<h2>` and its sections `<h3>`: the page's one
 * `<h1>` is the name. `id` goes on the first heading, for the section that
 * wraps the file to be named by. With `live`, a `code` span that is a
 * command becomes a button that runs it.
 *
 * The blocks of a file, the items of a list and the spans of a line come from
 * an immutable string and never reorder, so the index is a stable key for
 * each. React Doctor cannot tell, so its index-key rule is suppressed here.
 */
export default function Doc({ source, id, live }: { source: string; id?: string; live?: Live }) {
  const blocks = parse(source);
  const firstHeading = blocks.findIndex((b) => b.kind === "heading");
  return (
    <div className="mt-doc">
      {blocks.map((block, i) => {
        if (block.kind === "list") {
          return (
            // react-doctor-disable-next-line react-doctor/no-array-index-as-key
            <ul key={i}>
              {block.items.map((item, j) => (
                // react-doctor-disable-next-line react-doctor/no-array-index-as-key
                <li key={j}>
                  <Inline source={item} live={live} />
                </li>
              ))}
            </ul>
          );
        }
        if (block.kind === "para") {
          return (
            // react-doctor-disable-next-line react-doctor/no-array-index-as-key
            <p key={i}>
              <Inline source={block.text} live={live} />
            </p>
          );
        }
        const anchor = i === firstHeading ? id : undefined;
        if (block.level === 1) {
          return (
            // react-doctor-disable-next-line react-doctor/no-array-index-as-key
            <h2 key={i} id={anchor} className="mt-doc-title">
              <span>
                <Inline source={block.text} live={live} />
              </span>
            </h2>
          );
        }
        return (
          // react-doctor-disable-next-line react-doctor/no-array-index-as-key
          <h3 key={i} id={anchor} className="mt-doc-heading">
            <span aria-hidden>{"#".repeat(block.level)} </span>
            <Inline source={block.text} live={live} />
          </h3>
        );
      })}
    </div>
  );
}

/** A line's text with its code, strong text and links set. */
export function Inline({ source, live }: { source: string; live?: Live }) {
  // react-doctor-disable-next-line react-doctor/no-array-index-as-key
  return spans(source).map((span, i) => <Piece key={i} span={span} live={live} />);
}

function Piece({ span, live }: { span: Span; live?: Live }) {
  switch (span.kind) {
    case "text":
      return span.text;
    case "strong":
      return <strong>{span.text}</strong>;
    case "link":
      return <a href={span.href}>{span.text}</a>;
    case "code":
      return <Code text={span.text} live={live} />;
  }
}

/**
 * Quoted code: a button when the output is live and the code is a command
 * this shell can run, plain code otherwise. `usage` marks text that is a
 * command followed by its usage (`cat <file>`, as `help` lists it): the
 * button then stands for the command alone, since the placeholders are not
 * something to run.
 */
export function Code({ text, live, usage = false }: { text: string; live?: Live; usage?: boolean }) {
  const name = text.trim().split(/\s+/)[0] ?? "";
  if (live?.names.has(name.toLowerCase())) {
    const line = usage ? name : text;
    return (
      <button type="button" className="mt-run" onClick={() => live.press(line)}>
        {text}
      </button>
    );
  }
  return <code>{text}</code>;
}
