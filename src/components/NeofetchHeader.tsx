"use client";

import Image from "next/image";
import type { MouseEvent, ReactNode } from "react";
import { EMAIL, LINKS, PROFILE, WORLD_COMMAND, WORLD_LINES } from "@/components/terminal/content";
import { promptFor } from "@/components/terminal/shell";
import { Lights, ProxyIcon } from "@/components/terminal/WindowChrome";
import ReturnKey from "@/components/title/ReturnKey";
import type { HeaderProject } from "./headerProjects.ts";

export type { HeaderProject };

/** A ⏎ in a printed line becomes the pixel key cap; the rest of the line is text. */
function withReturns(line: string): ReactNode {
  const at = line.indexOf("⏎");
  if (at < 0) return line;
  return (
    <>
      {line.slice(0, at)}
      <ReturnKey className="nf-key" />
      {withReturns(line.slice(at + 1))}
    </>
  );
}

export interface NeofetchHeaderProps {
  projects: HeaderProject[];
  /** After the colour blocks, the terminal runs `./world` and prints how to enter. */
  world?: boolean;
  /** The window's yellow light. */
  onMinimize?: () => void;
  /** The window's green light. */
  onZoom?: () => void;
  /**
   * The live prompt, in place of the idle `./` row. The title's window is the
   * terminal; a page without this still asks the launcher to open one over it.
   */
  terminal?: ReactNode;
  /** The static rows above the prompt are gone: `clear`, or a full-screen program. */
  bare?: boolean;
}

/** Ask for the live shell: on the title, the window's own prompt. */
function openShell(trigger: HTMLElement | null) {
  window.dispatchEvent(
    new CustomEvent("terminal:open", { detail: { trigger } }),
  );
}

/**
 * zsh's stock prompt at home — uncoloured, as in a fresh Terminal. In a span
 * so the intro can bring it up after the window, apart from the cursor.
 */
function Prompt() {
  return <span className="nf-ps1">{promptFor("~")}</span>;
}

/**
 * `intro`: the one that follows the typing, and exists only while the intro plays. `world`: the same for the title's
 * `./world`, typed later.
 */
function Cursor({ intro = false, world = false }: { intro?: boolean; world?: boolean }) {
  const extra = intro ? " nf-cursor-intro" : world ? " nf-cursor-world" : "";
  return <span className={`nf-cursor${extra}`} aria-hidden />;
}

/**
 * The page header: a macOS Terminal window that has just run `neofetch`, with
 * the headshot standing in for the distro logo and the bio as the spec table —
 * the same bio the live shell's `neofetch` and ~/about.md print.
 *
 * It fills the first screen on its own, the window centred; the rest of the
 * page is below the fold. Scrolling docks the two: the window climbs to the
 * top at half speed while the projects come up under it (.nf-dock, and
 * globals.css, "Scroll reveal"). On the first load in a tab the session plays
 * out — a lone cursor, the window opening out of it, the command typed, the
 * output printing — all in CSS (globals.css, "Intro"), so this markup is the
 * finished state.
 *
 * Below 640px it does what neofetch itself does in a narrow terminal: the logo
 * block goes above the table and every Label / value pair stacks. The Contact
 * row becomes three 44pt prompt lines at the bottom so they are tappable.
 *
 * Any click on the body that is not on a link asks for the live shell.
 * On the title, `world` adds the `./world` lines and the yellow and green
 * lights are the ways in; the page's own CSS takes the full-screen height off.
 * With `terminal`, that shell is this window's own prompt.
 */
export default function NeofetchHeader({
  projects,
  world = false,
  onMinimize,
  onZoom,
  terminal,
  bare = false,
}: NeofetchHeaderProps) {
  // A build where no project has GitHub stats prints names and summaries. Counts, and the column that holds
  // them, appear only when at least one row actually has them.
  const anyStats = projects.some((p) => p.stats !== null);
  const onBodyClick = (e: MouseEvent<HTMLDivElement>) => {
    const target = e.target as Element;
    if (target.closest("a, button")) return;
    openShell(e.currentTarget);
  };

  return (
    <header
      id="about"
      className="nf flex min-h-svh flex-col justify-center px-5 sm:px-8 lg:px-10 print:min-h-0"
    >
      <div className="nf-dock">
        <div className="nf-frame">
          <div className="term-bar static">
            <Lights onMinimize={onMinimize} onZoom={onZoom} />
            <ProxyIcon />
            <div className="title">
              daniel — -zsh<span className="nf-title-dims"> — 132×38</span>
            </div>
          </div>
          {/* role=presentation: the body is not itself a control. The launcher
              button, the mobile `./shell` row and ⌘K are the accessible
              triggers; a click here is a pointer shortcut. */}
          <div
            className={`nf-body ink-panel${terminal ? " nf-live" : ""}`}
            role="presentation"
            onClick={onBodyClick}
          >
            {bare ? null : (
              <>
            <p className="nf-cmd">
              <Prompt />
              <span className="nf-typed">neofetch</span>
              <Cursor intro />
            </p>

            <div className="nf-grid">
              <div className="nf-face">
                <Image
                  src="/headshot.webp"
                  alt={PROFILE.name}
                  width={200}
                  height={200}
                  sizes="(max-width: 639px) 128px, 200px"
                  priority
                />
                <p className="nf-face-path">~/.face</p>
              </div>

              <div className="nf-info">
                <p className="nf-host">
                  daniel<span className="nf-at">@</span>portfolio
                </p>
                <hr className="nf-rule" />

                <dl className="nf-table">
                  <dt>Name</dt>
                  <dd>{PROFILE.name}</dd>
                  <dt>Title</dt>
                  <dd>{PROFILE.title}</dd>
                  <dt>Previously</dt>
                  <dd>{PROFILE.previously}</dd>
                  <dt>School</dt>
                  <dd>{PROFILE.school}</dd>
                  <dt>Location</dt>
                  <dd>{PROFILE.location}</dd>
                  {projects.length > 0 && (
                    <>
                      <dt>Projects</dt>
                      <dd>
                        <ul className={anyStats ? "nf-pins" : "nf-pins nf-pins-plain"}>
                          {projects.map((p) => (
                            <li key={p.name} className="nf-pin">
                              {anyStats ? (
                                p.stats ? (
                                  <span className="nf-pin-lang">
                                    <span
                                      className="nf-pin-dot"
                                      style={
                                        p.stats.language
                                          ? { backgroundColor: p.stats.language.color }
                                          : undefined
                                      }
                                      aria-hidden
                                    />
                                    {p.stats.language?.name ?? "n/a"}
                                  </span>
                                ) : (
                                  // Keeps the name and the counts in their columns when a neighbour has stats.
                                  <span className="nf-pin-lang" aria-hidden="true" />
                                )
                              ) : null}
                              {p.url ? (
                                <a
                                  className="nf-link nf-pin-name"
                                  href={p.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  {p.name}
                                </a>
                              ) : (
                                <span className="nf-pin-name">{p.name}</span>
                              )}
                              {p.stats ? (
                                <span className="nf-pin-stats">
                                  <span className="nf-stat">★ {p.stats.stars}</span>
                                  <span className="nf-stat">⑂ {p.stats.forks}</span>
                                </span>
                              ) : (
                                <span className="nf-pin-summary">{p.summary}</span>
                              )}
                            </li>
                          ))}
                        </ul>
                      </dd>
                    </>
                  )}
                  <dt className="nf-contact">Contact</dt>
                  <dd className="nf-contact">
                    <a className="nf-link" href={LINKS.email}>
                      {EMAIL}
                    </a>
                    {" · "}
                    <a className="nf-link" href={LINKS.resume} target="_blank" rel="noopener noreferrer">
                      resume.pdf
                    </a>
                  </dd>
                </dl>

                {/* neofetch's colour blocks — Terminal.app's 16 built-in ANSI colours. */}
                <div className="nf-swatches" aria-hidden>
                  <div>
                    {Array.from({ length: 8 }, (_, i) => (
                      <span key={i} style={{ background: `var(--term-ansi-${i})` }} />
                    ))}
                  </div>
                  <div>
                    {Array.from({ length: 8 }, (_, i) => (
                      <span key={i} style={{ background: `var(--term-ansi-${i + 8})` }} />
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {world ? (
              <>
                <p className="nf-cmd nf-world">
                  <Prompt />
                  <span className="nf-typed nf-typed-world">{WORLD_COMMAND}</span>
                  <Cursor world />
                </p>
                {WORLD_LINES.map((line) => (
                  <p className="nf-out" key={line}>
                    {withReturns(line)}
                  </p>
                ))}
              </>
            ) : null}
              </>
            )}

            {terminal ?? (
              <p className="nf-cmd nf-idle">
                <Prompt />
                <Cursor />
              </p>
            )}

            <div className="nf-actions">
              <a className="nf-action nf-link" href={LINKS.email}>
                % mail {EMAIL}
              </a>
              <a className="nf-action nf-link" href={LINKS.resume} target="_blank" rel="noopener noreferrer">
                % open resume.pdf
              </a>
              <button
                type="button"
                className="nf-action nf-shell"
                data-terminal-trigger=""
                aria-haspopup="dialog"
                onClick={(e) => openShell(e.currentTarget)}
              >
                <span>
                  % <span className="nf-shell-name">./shell</span>
                </span>
                <Cursor />
              </button>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
