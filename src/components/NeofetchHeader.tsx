"use client";

import Image from "next/image";
import type { MouseEvent } from "react";
import { promptFor } from "@/components/terminal/shell";
import { Lights, ProxyIcon } from "@/components/terminal/WindowChrome";

/** The slice of a pinned repo the header prints. Serializable — comes from the server page. */
export interface HeaderProject {
  name: string;
  url: string;
  language: { name: string; color: string } | null;
  stars: number;
  forks: number;
}

const EMAIL = "danielhkuo@rice.edu";
const RESUME = "/Daniel-Kuo-Resume.pdf";

/** Ask the TerminalLauncher to open the live shell, returning focus to `trigger` on close. */
function openShell(trigger: HTMLElement | null) {
  window.dispatchEvent(
    new CustomEvent("terminal:open", { detail: { trigger } }),
  );
}

/** zsh's stock prompt at home — uncoloured, as in a fresh Terminal. */
function Prompt() {
  return promptFor("~/");
}

function Cursor() {
  return <span className="nf-cursor" aria-hidden />;
}

/**
 * The page header: a macOS Terminal window that has just run `neofetch`, with
 * the headshot standing in for the distro logo and the bio as the spec table.
 * Replaces both the old Masthead card and the decorative #about panel; the id
 * stays so the shell's `cd about` still lands here.
 *
 * Below 640px it does what neofetch itself does in a narrow terminal: the logo
 * block goes above the table and every Label / value pair stacks. The Contact
 * row becomes three 44pt prompt lines at the bottom so they are tappable.
 *
 * Any click on the body that is not on a link opens the live shell over it.
 */
export default function NeofetchHeader({ projects }: { projects: HeaderProject[] }) {
  const onBodyClick = (e: MouseEvent<HTMLDivElement>) => {
    const target = e.target as Element;
    if (target.closest("a, button")) return;
    openShell(e.currentTarget);
  };

  return (
    <header id="about" className="nf scroll-mt-28 px-5 pt-24 pb-16 sm:px-8 sm:pt-40 lg:px-10">
      <div className="nf-frame">
        <div className="term-bar static">
          <Lights />
          <ProxyIcon />
          <div className="title">
            daniel — -zsh<span className="nf-title-dims"> — 132×38</span>
          </div>
        </div>
        {/* role=presentation: the body is not itself a control. The nav's
            Terminal button, the mobile `./shell` row and ⌘K are the
            accessible triggers; a click here is a pointer shortcut. */}
        <div className="nf-body ink-panel" role="presentation" onClick={onBodyClick}>
          <p className="nf-cmd">
            <Prompt />
            neofetch
          </p>

          <div className="nf-grid">
            <div className="nf-face">
              <Image
                src="/headshot.webp"
                alt="Daniel Kuo"
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
                <dd>Daniel Kuo</dd>
                <dt>Title</dt>
                <dd>Full-stack product builder &amp; team architect</dd>
                <dt>Previously</dt>
                <dd>Summer Analyst @ Goldman Sachs AWM</dd>
                <dt>School</dt>
                <dd>Rice University · CS</dd>
                <dt>Location</dt>
                <dd>Houston, TX</dd>
                {projects.length > 0 && (
                  <>
                    <dt>Pinned</dt>
                    <dd>
                      <ul className="nf-pins">
                        {projects.map((p) => (
                          <li key={p.name} className="nf-pin">
                            <span className="nf-pin-lang">
                              <span
                                className="nf-pin-dot"
                                style={
                                  p.language ? { backgroundColor: p.language.color } : undefined
                                }
                                aria-hidden
                              />
                              {p.language?.name ?? "n/a"}
                            </span>
                            <a
                              className="nf-link nf-pin-name"
                              href={p.url}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              {p.name}
                            </a>
                            <span className="nf-pin-stats">
                              <span className="nf-stat">★ {p.stars}</span>
                              <span className="nf-stat">⑂ {p.forks}</span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </dd>
                  </>
                )}
                <dt className="nf-contact">Contact</dt>
                <dd className="nf-contact">
                  <a className="nf-link" href={`mailto:${EMAIL}`}>
                    {EMAIL}
                  </a>
                  {" · "}
                  <a className="nf-link" href={RESUME} target="_blank" rel="noopener noreferrer">
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

          <p className="nf-cmd nf-idle">
            <Prompt />
            <Cursor />
          </p>

          <div className="nf-actions">
            <a className="nf-action nf-link" href={`mailto:${EMAIL}`}>
              % mail {EMAIL}
            </a>
            <a className="nf-action nf-link" href={RESUME} target="_blank" rel="noopener noreferrer">
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

    </header>
  );
}
