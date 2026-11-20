import type { Metadata } from "next";
import { FILE_NAME, danielTxt, lineNumbers, plainText } from "@/components/minimal/daniel";
import Footer from "@/components/minimal/Footer";
import { GoTo, Help } from "@/components/minimal/Panels";
import Text from "@/components/minimal/Text";
import { PROFILE } from "@/components/terminal/content";
import { loadProjects } from "@/lib/projects";
import { SITE_URL, TEXT_PAGE, otherPages, personJsonLd, profileSummary } from "@/lib/site-content";
import "./minimal.css";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: `${PROFILE.name} · ${PROFILE.title}`,
  description: profileSummary(),
  alternates: { canonical: TEXT_PAGE },
  openGraph: { type: "profile", url: TEXT_PAGE, title: PROFILE.name, description: profileSummary() },
};

/**
 * The minimal version: the whole site as one plain text file, daniel.txt, open in nano.
 *
 * The text is static HTML built from content.ts and the projects (daniel.ts): one h1, a heading per section,
 * real links. It reads with no JavaScript, in a screen reader and to a crawler. nano's dress is around it: the title
 * bar, the status line and the two rows of shortcuts, of which ^G Help, ^F Where Is, ^/ Go To Line and ^X Exit work
 * and the rest are decoration. The interactive shell lives in the title's terminal, not here.
 *
 * Design: docs/superpowers/specs/2026-11-19-minimal-terminal-design.md, section 13.
 */
export default async function MinimalVersion() {
  const projects = await loadProjects();
  const doc = danielTxt(projects, otherPages(TEXT_PAGE));

  return (
    <div className="nano">
      <div className="nano-bar" aria-hidden="true">
        <span>GNU nano 8.2</span>
        <span className="nano-file">{FILE_NAME}</span>
        <span />
      </div>
      <main className="nano-text">
        <Text doc={doc} />
      </main>
      <Footer lines={plainText(doc).length} />
      <Help />
      <GoTo marks={lineNumbers(doc)} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(personJsonLd()) }} />
    </div>
  );
}
