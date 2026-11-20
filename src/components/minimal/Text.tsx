import type { CSSProperties } from "react";
import { INDENT, labelWidth, nameWidth, type Daniel, type Entry, type Fact, type Link, type Section } from "./daniel";

/**
 * daniel.txt as the page sets it: what nano would show, as headings, lists and links. One h1 (the name), an h2 for
 * each section in plain caps, labelled rows as a description list, entries as a list. Columns are in `ch`, so in a
 * monospace face they line up as the file's padding does. No script.
 */
export default function Text({ doc }: { doc: Daniel }) {
  const columns = { "--nano-label": `${labelWidth(doc)}ch`, "--nano-indent": `${INDENT}ch` } as CSSProperties;
  return (
    <div className="nano-doc" style={columns}>
      <h1 id="top">{doc.name}</h1>
      <p>{doc.title}</p>
      <Facts facts={doc.facts} />
      {doc.sections.map((section) => (
        <Part key={section.id} section={section} />
      ))}
    </div>
  );
}

function A({ link }: { link: Link }) {
  return <a href={link.href}>{link.text}</a>;
}

function Piece({ piece }: { piece: string | Link }) {
  return typeof piece === "string" ? piece : <A link={piece} />;
}

function Facts({ facts }: { facts: readonly Fact[] }) {
  return (
    <dl className="nano-facts">
      {facts.map((f) => (
        <div key={f.label}>
          <dt>{f.label}</dt>
          <dd>
            <Piece piece={f.value} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Entries({ section }: { section: Section }) {
  const width = { "--nano-name": `${nameWidth(section)}ch` } as CSSProperties;
  return (
    <ul className="nano-entries" style={width}>
      {section.entries?.map((entry: Entry) => (
        <li key={entry.link.href}>
          <p className={entry.note ? "nano-head nano-noted" : "nano-head"}>
            <A link={entry.link} />
            {entry.note && <span>{entry.note}</span>}
          </p>
          {entry.lines.map((line) => (
            <p key={typeof line === "string" ? line : line.href} className="nano-under">
              <Piece piece={line} />
            </p>
          ))}
        </li>
      ))}
    </ul>
  );
}

function Part({ section }: { section: Section }) {
  return (
    <section aria-labelledby={section.id}>
      <h2 id={section.id}>{section.heading}</h2>
      {section.note && (
        <p>
          {section.note.map((piece) => (
            <Piece key={typeof piece === "string" ? piece : piece.href} piece={piece} />
          ))}
        </p>
      )}
      {section.facts && <Facts facts={section.facts} />}
      {section.entries && <Entries section={section} />}
    </section>
  );
}
