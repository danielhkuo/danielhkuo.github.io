import { type CSSProperties } from "react";
import { isPlain, runClass, runStyle, trimRuns } from "@/components/terminal/screenHtml";
import { xtermToCss } from "@/components/terminal/tty/colors";
import type { TerminalLine, TextRun } from "@/components/terminal/types";
import Banner from "./Banner";
import Doc, { Code, type Live } from "./Doc";

/**
 * The prompt, `%n@%m %1~ %# ` as zsh writes it. It is decoration: a screen
 * reader skips it, and it cannot be selected, so copying a command takes the
 * command alone. A phone drops user@host (minimal.css): the whole of it
 * leaves about sixteen characters to type in.
 */
export function Prompt({ path }: { path: string }) {
  const dir = path.split("/").pop() || "/";
  return (
    <span className="mt-ps" aria-hidden>
      <span className="mt-ps-host">daniel@portfolio </span>
      {dir} %{" "}
    </span>
  );
}

/** A command as it was entered: the prompt, then the line. Read aloud as "Command: …". */
export function CommandLine({ path, text }: { path: string; text: string }) {
  return (
    <p className="mt-cmd">
      <Prompt path={path} />
      <span className="mt-sr">Command: </span>
      <span className="mt-typed-cmd">{text}</span>
    </p>
  );
}

/**
 * One line of what a command printed, as HTML: a file as a document, a
 * listing as rows, `help` as a list of names and what they do.
 *
 * With `live`, a listed file, a command in `help` and a command quoted in
 * text are buttons that run it. Without it, as in the page's static start,
 * they are text.
 *
 * `id` and `lead` are for that static start: the anchor the section is named
 * by, and neofetch as the page's heading.
 *
 * Printed rows, their runs and the parts of a line never reorder, so the
 * index is a stable key for each. React Doctor cannot tell, so its index-key
 * rule is suppressed here.
 */
export function Line({
  line,
  live,
  id,
  lead = false,
}: {
  line: TerminalLine;
  live?: Live;
  id?: string;
  lead?: boolean;
}) {
  switch (line.kind) {
    case "cmd":
      return <CommandLine path={line.path} text={line.text} />;
    case "doc":
      return <Doc source={line.source} id={id} live={live} />;
    case "neofetch":
      return <Banner id={id} lead={lead} />;
    case "text":
      return (
        <div className={live ? "mt-text mt-live" : "mt-text"}>
          {line.rows.map((runs, y) => (
            // react-doctor-disable-next-line react-doctor/no-array-index-as-key
            <div key={y} className="mt-text-row">
              {runs.map((run, i) => (
                // react-doctor-disable-next-line react-doctor/no-array-index-as-key
                <Run key={i} run={run} live={live} />
              ))}
            </div>
          ))}
        </div>
      );
    case "rows":
      return (
        <div className="mt-help">
          {line.title && <p className="mt-help-title">{line.title}</p>}
          <dl>
            {line.rows.map((row) => (
              <div key={row.k}>
                <dt>
                  <Code text={row.k} live={live} usage />
                </dt>
                <dd>
                  <Rich text={row.v} live={live} />
                </dd>
              </div>
            ))}
          </dl>
        </div>
      );
    case "screen":
      return (
        <pre className="term-grid mt-grid" role="img" aria-label="A bonsai tree drawn in characters">
          {line.rows.map((runs, y) => (
            // react-doctor-disable-next-line react-doctor/no-array-index-as-key
            <div key={y} className="term-grid-row">
              {trimRuns(runs).map((run, i) =>
                isPlain(run) ? (
                  run.text
                ) : (
                  // react-doctor-disable-next-line react-doctor/no-array-index-as-key
                  <span key={i} className={runClass(run)} style={runStyle(run)}>
                    {run.text}
                  </span>
                ),
              )}
            </div>
          ))}
        </pre>
      );
    default:
      // Output and errors look alike, as stdout and stderr do in a terminal.
      return (
        <p className="mt-line">
          <Rich text={line.text} live={live} />
        </p>
      );
  }
}

/** Text with its `backtick` spans set as code: buttons, where they are commands and the line is live. */
function Rich({ text, live }: { text: string; live?: Live }) {
  return text.split("`").map((part, i) =>
    // react-doctor-disable-next-line react-doctor/no-array-index-as-key
    i % 2 === 1 ? <Code key={i} text={part} live={live} /> : part,
  );
}

/** One run of a printed row: a link, a button for what it stands for, or styled text. */
function Run({ run, live }: { run: TextRun; live?: Live }) {
  const className = [run.bold && "tb", run.underline && "tu"].filter(Boolean).join(" ") || undefined;
  const style = colors(run);
  if (run.href) {
    return (
      <a className={className} style={style} href={run.href}>
        {run.text}
      </a>
    );
  }
  const command = run.run;
  if (live && command) {
    return (
      <button
        type="button"
        className={className ? `mt-run ${className}` : "mt-run"}
        style={style}
        onClick={() => live.press(command)}
      >
        {run.text}
      </button>
    );
  }
  if (!className && !style) return run.text;
  return (
    <span className={className} style={style}>
      {run.text}
    </span>
  );
}

/** A run's colours, inline: any of xterm's 256. */
function colors(run: TextRun): CSSProperties | undefined {
  if (run.fg === undefined && run.bg === undefined) return undefined;
  const style: CSSProperties = {};
  if (run.fg !== undefined) style.color = xtermToCss(run.fg);
  if (run.bg !== undefined) style.background = xtermToCss(run.bg);
  return style;
}
