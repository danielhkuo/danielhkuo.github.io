"use client";

// The Codex: what is kept at the landmark the dragon has landed on, on a leaf of Ink & Glyph paper. Game layer: hand
// drawn in CSS and SVG, not Astryx. (The prompt that offers a landing is drawn into the world: controls/guides.ts.)

import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { GLASS, INTERESTS, LINKS, PROFILE } from "../../components/terminal/content";
import { kindName, type HallProject, type Landmark } from "../../world/sites/landmarks";
import { choose, complete, type QuestState } from "../../world/story/quest";
import { PIECE_RGB, STOPS, type StopKey } from "../../world/story/stops";
import styles from "./codex.module.css";
import { fell } from "./fonts";
import { Pane } from "./panes";
import { getQuest, setQuest, useQuest } from "./questStore";

const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

function dateOf(iso: string): string | null {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : DATE.format(t);
}

/** A count, in words when there are none: the face's old-style zero reads as a letter o. */
function count(n: number): string {
  return n === 0 ? "none yet" : n.toLocaleString("en-GB");
}

function capitalised(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);
}

/** PIECE_RGB, packed RGBA with red in the low byte, as a CSS colour. */
function pieceCss(packed: number): string {
  return `rgb(${packed & 255} ${(packed >>> 8) & 255} ${(packed >>> 16) & 255})`;
}

/** A stop's title: drop a leading "the ", then capitalise. "the walled garden" → "Walled garden". */
function stopTitle(name: string): string {
  return capitalised(name.replace(/^the /, ""));
}

/** Blank lines divide the body. What is between them is text, never markup. */
function paragraphs(body: string): string[] {
  const out: string[] = [];
  for (const part of body.split(/\n\s*\n/)) {
    const text = part.replace(/[ \t]*\n[ \t]*/g, " ").trim();
    if (text) out.push(text);
  }
  return out;
}

function interestLine(key: string): string {
  for (const item of INTERESTS) if (item.key === key) return item.line;
  return "";
}

/** A row's words: the fact once found; on that stop's own page, "found here", because the lede already says the fact. */
function pieceDetail(interest: string, found: boolean, here: boolean): { text: string; aside: boolean } {
  if (here) return { text: "found here", aside: true };
  if (found) return { text: interestLine(interest), aside: false };
  return { text: "not yet found", aside: true };
}

/**
 * Four lobes, inked round. Filled with `fill` when that piece is found (vermilion when no colour is given, as on a
 * link), and paper when not, so an empty one stays an outlined quatrefoil.
 */
function Quatrefoil({ className, filled = true, fill }: { className?: string; filled?: boolean; fill?: string }) {
  const lobes = (kind: string) =>
    [
      [2.2, 0],
      [-2.2, 0],
      [0, 2.2],
      [0, -2.2],
    ].map(([cx, cy]) => <circle key={`${kind}${cx},${cy}`} cx={cx} cy={cy} r={2.4} />);
  const colour = filled && fill ? ({ "--foil": fill } as CSSProperties) : undefined;
  return (
    <svg className={className} viewBox="-6 -6 12 12" aria-hidden="true" focusable="false" style={colour}>
      <g fill="none" stroke="currentColor" strokeWidth={1.5}>
        {lobes("s")}
      </g>
      <g className={filled ? styles.lobes : styles.empty}>{lobes("f")}</g>
    </svg>
  );
}

/** A flourished corner: an inner rule that turns the corner in a curve, a scroll at each end, and a quatrefoil with a gold boss. */
function Corner({ className }: { className: string }) {
  const lobes = [
    [2.3, 0],
    [-2.3, 0],
    [0, 2.3],
    [0, -2.3],
  ].map(([cx, cy]) => <circle key={`${cx},${cy}`} cx={cx} cy={cy} r={2.5} />);
  return (
    <svg className={`${styles.corner} ${className}`} viewBox="0 0 40 40" aria-hidden="true" focusable="false">
      <path d="M4 38 V17 C4 9.5 9.5 4 17 4 H38" fill="none" stroke="currentColor" strokeWidth={1.4} />
      <path d="M9 38 V20 C9 14 14 9 20 9 H38" fill="none" stroke="currentColor" strokeWidth={0.7} />
      <path d="M38 4 C34 4 33 7.5 35.5 8.5" fill="none" stroke="currentColor" strokeWidth={1} />
      <path d="M4 38 C4 34 7.5 33 8.5 35.5" fill="none" stroke="currentColor" strokeWidth={1} />
      <g transform="translate(14.5 14.5)">
        <g fill="none" stroke="currentColor" strokeWidth={1.6}>
          {lobes}
        </g>
        <g className={styles.lobes}>{lobes}</g>
        <circle className={styles.boss} r={1.2} />
      </g>
    </svg>
  );
}

/**
 * A title whose first letter is illuminated: vermilion, gold-ruled. The initial is an inline block, which splits the
 * word in the accessible name ("E mpty-state-repo"), so the heading, and the Codex it labels, is named by the text.
 */
function Illuminated({ text }: { text: string }) {
  return (
    <h2 id="codex-title" className={styles.title} aria-label={text}>
      <span className={styles.initial}>{text.charAt(0)}</span>
      {text.slice(1)}
    </h2>
  );
}

function Ledger({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className={styles.ledger}>
      {rows.map(([k, v]) => (
        <div key={k} className={styles.row}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Links({ links }: { links: { href: string; label: string; external: boolean }[] }) {
  return (
    <ul className={styles.links}>
      {links.map((l) => (
        <li key={l.href}>
          <Quatrefoil className={styles.bullet} />
          <a href={l.href} {...(l.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
            {l.label}
          </a>
        </li>
      ))}
    </ul>
  );
}

function Rubric({ children }: { children: ReactNode }) {
  return (
    <p className={styles.rubric}>
      <span aria-hidden="true">¶ </span>
      {children}
    </p>
  );
}

function ledgerOf(project: HallProject): [string, ReactNode][] {
  const github = project.github;
  if (!github) return [];
  const rows: [string, ReactNode][] = [];
  if (github.language) rows.push(["Written in", github.language.name]);
  rows.push(["Stars", count(github.stars)], ["Forks", count(github.forks)]);
  const updated = dateOf(github.updatedAt);
  if (updated) rows.push(["Last worked on", updated]);
  return rows;
}

/** How far an arrow key reads down the hall list, about one short row. */
const LIST_LINE = 48;

/** Arrow keys read the hall list while the leaf itself has focus. A row button keeps its own keys. */
function readList(e: KeyboardEvent<HTMLDivElement>, el: HTMLElement | null): void {
  if (!el || e.target !== e.currentTarget) return;
  const page = Math.max(LIST_LINE, el.clientHeight - LIST_LINE);
  let delta = 0;
  if (e.key === "ArrowDown") delta = LIST_LINE;
  else if (e.key === "ArrowUp") delta = -LIST_LINE;
  else if (e.key === "PageDown") delta = page;
  else if (e.key === "PageUp") delta = -page;
  else if (e.key === "Home") delta = -el.scrollHeight;
  else if (e.key === "End") delta = el.scrollHeight;
  else return;
  if (el.scrollHeight <= el.clientHeight + 1) return;
  const before = el.scrollTop;
  el.scrollBy({ top: delta });
  if (el.scrollTop !== before) e.preventDefault();
}

/** True while `node` can still scroll down, so a scroller can fade its bottom edge and clear the fade at the end. */
function useMoreBelow(node: RefObject<HTMLElement | null>, watch: unknown): boolean {
  const [more, setMore] = useState(false);
  useEffect(() => {
    const el = node.current;
    if (!el) return;
    let alive = true;
    const update = () => {
      if (!alive) return;
      const next = el.scrollHeight - el.scrollTop - el.clientHeight > 2;
      setMore((prev) => (prev === next ? prev : next));
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const observed = new ResizeObserver(update);
    observed.observe(el);
    for (const child of el.children) observed.observe(child);
    void document.fonts?.ready.then(update);
    return () => {
      alive = false;
      el.removeEventListener("scroll", update);
      observed.disconnect();
    };
  }, [node, watch]);
  return more;
}

function HallList({
  projects,
  onOpen,
  bindRow,
  scrollRef,
}: {
  projects: readonly HallProject[];
  onOpen: (slug: string) => void;
  bindRow: (el: HTMLButtonElement | null) => void;
  scrollRef: RefObject<HTMLDivElement | null>;
}) {
  const more = useMoreBelow(scrollRef, projects.length);
  return (
    <>
      <div className={styles.hallHead}>
        <Rubric>The hall</Rubric>
        <Illuminated text="Projects" />
      </div>
      <div ref={scrollRef} className={styles.projectScroll} data-more={more ? "true" : "false"}>
        {projects.length === 0 ? (
          <p className={styles.lede}>No projects are listed yet.</p>
        ) : (
          <ul className={styles.projects}>
            {projects.map((project) => (
              <li key={project.slug}>
                <button type="button" className={styles.project} data-slug={project.slug} ref={bindRow} onClick={() => onOpen(project.slug)}>
                  <span className={styles.projectName}>{project.name}</span>
                  {project.summary ? <span className={styles.projectSummary}>{project.summary}</span> : null}
                  {project.github?.language ? <span className={styles.projectLang}>{project.github.language.name}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

function ProjectLeaf({ project, onBack }: { project: HallProject; onBack: () => void }) {
  const links: { href: string; label: string; external: boolean }[] = [];
  if (project.repoUrl) links.push({ href: project.repoUrl, label: "Read the source", external: true });
  if (project.link) links.push({ href: project.link, label: "Visit it", external: true });
  const rows = ledgerOf(project);
  return (
    <>
      <Rubric>Kept in the hall</Rubric>
      <Illuminated text={project.name} />
      {project.summary ? <p className={styles.lede}>{project.summary}</p> : null}
      {project.image ? (
        // The file's size is the project's own; the leaf only bounds it.
        // eslint-disable-next-line @next/next/no-img-element
        <img className={styles.figure} src={project.image} alt={project.name} />
      ) : null}
      {paragraphs(project.body).map((text, i) => (
        <p key={`${i}:${text}`} className={styles.prose}>
          {text}
        </p>
      ))}
      {rows.length > 0 ? <Ledger rows={rows} /> : null}
      <div className={styles.back}>
        <button type="button" className={styles.button} onClick={onBack}>
          Back to the hall
        </button>
      </div>
      {links.length > 0 ? <Links links={links} /> : null}
    </>
  );
}

function StopLeaf({ stop }: { stop: StopKey }) {
  const found = STOPS.find((item) => item.key === stop);
  const line = found ? interestLine(found.interest) : "";
  return (
    <>
      <Rubric>Found</Rubric>
      <Illuminated text={stopTitle(found ? found.name : stop)} />
      <Pane stop={stop} className={styles.paneLarge} />
      {line ? <p className={styles.lede}>{line}</p> : null}
      {stop === "pine" ? (
        <p className={styles.note}>
          Try <code>cbonsai</code> in the terminal at the abbey.
        </p>
      ) : null}
    </>
  );
}

function AboutLeaf({ kind }: { kind: string }) {
  return (
    <>
      <Rubric>The {kind}</Rubric>
      <Illuminated text={PROFILE.name} />
      <p className={styles.lede}>{PROFILE.title}</p>
      <Ledger
        rows={[
          ["Previously", PROFILE.previously],
          ["Studies", PROFILE.school],
          ["Lives in", PROFILE.location],
          ["Builds", PROFILE.building],
        ]}
      />
      <Links
        links={[
          { href: LINKS.github, label: "GitHub", external: true },
          { href: LINKS.linkedin, label: "LinkedIn", external: true },
          { href: LINKS.email, label: "Email", external: false },
          { href: LINKS.resume, label: "Résumé", external: true },
        ]}
      />
    </>
  );
}

/**
 * What the quest collects, how many are found, and one row for each place. `shown` is the stop this page already
 * states, so its row says it was found here and does not repeat the fact.
 */
function Five({ quest, onFollow, shown }: { quest: QuestState; onFollow: () => void; shown?: StopKey }) {
  const n = STOPS.filter((stop) => quest.found.includes(stop.key)).length;
  const done = complete(quest);
  const many = GLASS.many;
  return (
    <section className={styles.register} aria-labelledby="codex-five">
      <h3 id="codex-five">
        {"Glass for the rose window · "}
        <span className={styles.figures}>{n}</span>
        {" of "}
        <span className={styles.figures}>{STOPS.length}</span>
      </h3>
      {done ? null : (
        <p className={styles.questLine}>
          The hall&apos;s rose window is missing five {GLASS.whole}. One is kept at each of five places, and each tells
          you something about Daniel.
        </p>
      )}
      <div className={styles.foils} role="group" aria-label={`${n} of ${STOPS.length} ${many} found`}>
        {STOPS.map((stop) => {
          const found = quest.found.includes(stop.key);
          return (
            <Quatrefoil key={stop.key} className={styles.foil} filled={found} fill={found ? pieceCss(PIECE_RGB[stop.key]) : undefined} />
          );
        })}
      </div>
      <ul className={styles.pieces}>
        {STOPS.map((stop) => {
          const found = quest.found.includes(stop.key);
          const here = shown === stop.key;
          const detail = pieceDetail(stop.interest, found, here);
          return (
            <li key={stop.key} className={styles.piece}>
              <span
                className={styles.swatch}
                style={found || here ? { backgroundColor: pieceCss(PIECE_RGB[stop.key]) } : undefined}
                aria-hidden="true"
              />
              <span className={styles.pieceLine}>
                {capitalised(stop.name)}
                <span className={detail.aside ? styles.pieceAside : styles.pieceFact}> {detail.text}</span>
              </span>
            </li>
          );
        })}
      </ul>
      {done ? (
        <>
          <p className={styles.closing}>The rose window is whole.</p>
          <p className={styles.closing}>
            {"Those are five of the things Daniel cares about. If you'd like to tell him yours:"}
          </p>
          <Links links={[{ href: LINKS.email, label: "Write to Daniel", external: false }]} />
        </>
      ) : quest.mode !== "on" ? (
        <button type="button" className={`${styles.button} ${styles.follow}`} onClick={onFollow}>
          Look for the glass
        </button>
      ) : null}
    </section>
  );
}

export interface CodexProps {
  landmark: Landmark;
  onTakeOff: () => void;
  /**
   * The abbey's button: opens the terminal, which gives focus back to `trigger` when it closes; on a phone, which has
   * no terminal, the minimal version.
   */
  onOpenTerminal: (trigger: HTMLElement) => void;
  /** What that button says: "Open the terminal", or on a phone "Read the minimal version". */
  openLabel: string;
}

/** The Codex for the landmark the dragon rests at: a labelled, non-modal dialog that takes focus when it opens. */
export default function Codex({ landmark, onTakeOff, onOpenTerminal, openLabel }: CodexProps) {
  const leaf = useRef<HTMLDivElement>(null);
  const listScroll = useRef<HTMLDivElement>(null);
  const rows = useRef(new Map<string, HTMLButtonElement>());
  const restore = useRef<string | null>(null);
  const [pick, setPick] = useState<{ id: string; slug: string } | null>(null);
  const quest = useQuest();
  const slug = pick && pick.id === landmark.id ? pick.slug : null;
  const project = landmark.holds.kind === "hall" && slug ? landmark.holds.projects.find((item) => item.slug === slug) ?? null : null;
  const openSlug = project?.slug ?? null;

  const bindRow = useCallback((el: HTMLButtonElement | null) => {
    if (!el?.dataset.slug) return;
    rows.current.set(el.dataset.slug, el);
  }, []);

  useEffect(() => {
    restore.current = null;
    const node = leaf.current;
    if (!node) return;
    node.scrollTop = 0;
    node.focus({ preventScroll: true });
  }, [landmark.id]);

  useEffect(() => {
    const node = leaf.current;
    if (openSlug) {
      if (!node) return;
      node.scrollTop = 0;
      node.focus({ preventScroll: true });
      return;
    }
    const slugToRestore = restore.current;
    if (!slugToRestore) return;
    restore.current = null;
    if (node) node.scrollTop = 0;
    rows.current.get(slugToRestore)?.focus();
  }, [openSlug, landmark.id]);

  const openProject = (projectSlug: string) => {
    restore.current = null;
    setPick({ id: landmark.id, slug: projectSlug });
  };
  const backToHall = () => {
    restore.current = openSlug;
    setPick(null);
  };
  const follow = () => {
    setQuest(choose(getQuest(), "on"));
    leaf.current?.focus({ preventScroll: true });
  };

  const kind = kindName(landmark.type);
  const projectPage = project !== null;
  const hallList = landmark.holds.kind === "hall" && !projectPage;
  // The hall list fades on its own scroller. Everywhere else the leaf scrolls, and the same fade marks more below it.
  const leafMore = useMoreBelow(leaf, `${landmark.id}:${openSlug ?? ""}:${quest.mode}:${quest.found.join(",")}`);
  let body: ReactNode;
  if (landmark.holds.kind === "hall") {
    body = project ? (
      <ProjectLeaf project={project} onBack={backToHall} />
    ) : (
      <HallList projects={landmark.holds.projects} onOpen={openProject} bindRow={bindRow} scrollRef={listScroll} />
    );
  } else if (landmark.holds.kind === "about") {
    body = <AboutLeaf kind={kind} />;
  } else {
    body = <StopLeaf stop={landmark.holds.stop} />;
  }

  return (
    // Non-modal: the scene stays live round it, and the page's keys still reach the dragon.
    <dialog
      open
      className={hallList ? `${styles.codex} ${styles.hallCodex} ${fell.variable}` : `${styles.codex} ${fell.variable}`}
      aria-labelledby="codex-title"
    >
      <Corner className={styles.tl} />
      <Corner className={styles.tr} />
      <Corner className={styles.br} />
      <Corner className={styles.bl} />
      {/* The leaf takes focus, so arrow keys read down it. The hall's list scrolls inside the leaf. */}
      <div
        ref={leaf}
        className={hallList ? `${styles.leaf} ${styles.hallLeaf}` : styles.leaf}
        data-more={!hallList && leafMore ? "true" : "false"}
        tabIndex={-1}
        onKeyDown={(e) => readList(e, listScroll.current)}
      >
        {body}
        {projectPage ? null : (
          <Five quest={quest} onFollow={follow} shown={landmark.holds.kind === "stop" ? landmark.holds.stop : undefined} />
        )}
        <p className={styles.actions}>
          {landmark.holds.kind === "about" ? (
            <button type="button" className={styles.button} data-terminal-trigger="" onClick={(e) => onOpenTerminal(e.currentTarget)}>
              {openLabel}
            </button>
          ) : null}
          <button type="button" className={styles.button} onClick={onTakeOff} aria-keyshortcuts="Space">
            Take off <kbd>Space</kbd>
          </button>
          {/* On a short window the hall's register has no room for its button, and it stands here, beside Take off
              (codex.module.css shows one of the two). */}
          {hallList && !complete(quest) && quest.mode !== "on" ? (
            <button type="button" className={`${styles.button} ${styles.followAction}`} onClick={follow}>
              Look for the glass
            </button>
          ) : null}
        </p>
      </div>
    </dialog>
  );
}
