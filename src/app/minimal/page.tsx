import { statSync } from "node:fs";
import path from "node:path";
import type { Metadata } from "next";
import { CommandLine, Line } from "@/components/minimal/Lines";
import Session from "@/components/minimal/Session";
import { LOGIN_TTY, loginLine, opening } from "@/components/minimal/transcript";
import { PROFILE } from "@/components/terminal/content";
import type { SiteInfo, SlimProject } from "@/components/terminal/types";
import { Lights, ProxyIcon } from "@/components/terminal/WindowChrome";
import { loadPinnedRepos } from "@/lib/github";
import {
  SITE_PAGES,
  SITE_URL,
  TEXT_PAGE,
  personJsonLd,
  profileSummary,
  publishedProjects,
} from "@/lib/site-content";
import "./minimal.css";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: `${PROFILE.name} · ${PROFILE.title}`,
  description: profileSummary(),
  alternates: { canonical: TEXT_PAGE },
  openGraph: { type: "profile", url: TEXT_PAGE, title: PROFILE.name, description: profileSummary() },
};

const INTRO = `(function(){try{var d=document.documentElement;if(!location.hash&&!sessionStorage.getItem('mt-intro')&&!matchMedia('(prefers-reduced-motion:reduce)').matches){sessionStorage.setItem('mt-intro','1');d.setAttribute('data-mt-intro','');setTimeout(function(){d.removeAttribute('data-mt-intro')},2400)}}catch(e){}})()`;

/**
 * The minimal version and the terminal, as one page.
 *
 * It is a Terminal window whose scrollback is the whole site, already
 * printed: the commands in `OPENING` are run on the real shell while the
 * site is built, and what they print is set here as static HTML, with
 * headings, lists and links. So it reads with no JavaScript, in a screen
 * reader and to a crawler, and nothing waits behind a command. Its last line
 * is a live prompt (`Session`), where the same commands and the rest can be
 * typed or tapped.
 *
 * Everything shown comes from content.ts and the pinned repos, through the
 * terminal's own files (site.ts).
 *
 * Design: docs/superpowers/specs/2026-11-19-minimal-terminal-design.md.
 */
export default async function MinimalVersion() {
  // The mock repos that stand in for a build without a token are not Daniel's work.
  const projects: SlimProject[] = publishedProjects(await loadPinnedRepos()).map((p) => ({
    name: p.name,
    description: p.description,
    url: p.url,
    homepageUrl: p.homepageUrl,
    primaryLanguage: p.primaryLanguage,
    languages: p.languages.map((l) => ({ name: l.name, percentage: l.percentage })),
    stargazerCount: p.stargazerCount,
    forkCount: p.forkCount,
    updatedAt: p.updatedAt,
  }));

  // What only the build knows: when it ran, the résumé's size, and the site's
  // other pages, which become ~/sitemap.md.
  const site: SiteInfo = {
    builtAt: new Date().toISOString(),
    resumeBytes: statSync(path.join(process.cwd(), "public", "Daniel-Kuo-Resume.pdf")).size,
    pages: SITE_PAGES.filter((page) => page.path !== TEXT_PAGE).map(({ title, path: to, summary }) => ({
      title,
      path: to,
      summary,
    })),
  };

  return (
    <div className="mt-page">
      {/* The start plays once per tab: `neofetch` is typed and its output
          prints (minimal.css, "The start"). This stamps the attribute that
          gates it before the window paints, and takes it off again when it
          is over, so a reload, a deep link, reduced motion and a visit
          without JavaScript all get the finished page. */}
      <script dangerouslySetInnerHTML={{ __html: INTRO }} />

      <a className="mt-skip" href="#prompt">
        Skip to the command prompt
      </a>

      <div className="mt-win">
        {/* The window's title bar. Closing a window that is a page goes back
            to the title menu; the other lights and the title are decoration. */}
        <header className="term-bar static mt-bar">
          <Lights closeHref="/" closeLabel="Close: back to the title menu" />
          <ProxyIcon />
          <div className="title" aria-hidden>
            daniel — -zsh
          </div>
        </header>

        <main className="mt-body">
          <p className="mt-login" aria-hidden>
            {loginLine(site.builtAt)}
            <span className="mt-login-tty">{LOGIN_TTY}</span>
          </p>

          {opening(projects, site).map((printed, i) => (
            <section key={printed.id} className="mt-entry" aria-labelledby={printed.id}>
              <CommandLine path="~" text={printed.line} />
              {printed.output.map((line, j) => (
                // What a command printed never reorders, so the index is a stable key.
                <Line key={j} line={line} id={printed.id} lead={i === 0} />
              ))}
            </section>
          ))}

          <Session projects={projects} site={site} />
        </main>
      </div>

      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(personJsonLd()) }} />
    </div>
  );
}
