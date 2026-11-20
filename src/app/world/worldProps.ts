// Server only: the world's build-time props, shared by /world and the title. Both pages hand Flight the same landmarks
// and the same abbey terminal, so the warning about a changed assignment file stays in this one place.

import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { PinnedRepo } from "@/lib/github";
import { otherPages } from "@/lib/site-content";
import { LANDMARK_CONFIG } from "@/world/landmarks.config";
import sticky from "@/world/sites/assignments.json";
import { entryOf, landmarksFor, stickyText, type LandmarkSet } from "@/world/sites/landmarks";
import type { TerminalProps } from "./useTerminalDrawer";
import { startBytes } from "./startBytes";

/** A pinned repo, as `fetchPinnedRepos` returns it. */
type Repo = PinnedRepo;

/** The shipped world's manifest, read from public/world at build time; null when the world files are absent. */
function shippedManifest(): { worldId: string; n: number; sites: { id: string; type: string; x: number; y: number }[] } | null {
  try {
    const dir = path.join(process.cwd(), "public", "world");
    const { worldId } = JSON.parse(readFileSync(path.join(dir, "current.json"), "utf8")) as { worldId: string };
    const m = JSON.parse(readFileSync(path.join(dir, worldId, "manifest.json"), "utf8")) as { n: number; sites: { id: string; type: string; x: number; y: number }[] };
    return { worldId, n: m.n, sites: m.sites };
  } catch {
    return null;
  }
}

/**
 * Landmarks from the shipped world, the terminal at the abbey, and how many bytes the flight fetches before its first
 * view. The abbey's `pages` are the site's other pages, so its files are the minimal version's.
 */
export function worldProps(repos: Repo[]): { landmarks: LandmarkSet | null; terminal: TerminalProps; startBytes: number } {
  const manifest = shippedManifest();
  let landmarks: LandmarkSet | null = null;
  if (manifest) {
    const placed = landmarksFor(manifest, repos.map(entryOf), LANDMARK_CONFIG, sticky);
    landmarks = placed.set;
    // Without a token the repos are stand-ins, and their places mean nothing.
    if (placed.changed && process.env.GITHUB_TOKEN) {
      console.warn(`world: the pinned repos' sites have changed. Commit this as src/world/sites/assignments.json:\n${stickyText(manifest.worldId, placed.bySite)}`);
    }
  }

  // The terminal at the abbey gets a slim slice of each repo, and what only the build knows. The site's other pages are
  // among that: given them, its files are the minimal version's (a contact card that stands by itself, where the old
  // home page's pointed at a form this page does not have; ~/sitemap.md; projects/README.md).
  const terminal = {
    projects: repos.map((p) => ({
      name: p.name,
      description: p.description,
      url: p.url,
      homepageUrl: p.homepageUrl,
      primaryLanguage: p.primaryLanguage,
      languages: p.languages.map((l) => ({ name: l.name, percentage: l.percentage })),
      stargazerCount: p.stargazerCount,
      forkCount: p.forkCount,
      updatedAt: p.updatedAt,
    })),
    site: {
      builtAt: new Date().toISOString(),
      resumeBytes: statSync(path.join(process.cwd(), "public", "Daniel-Kuo-Resume.pdf")).size,
      pages: otherPages("/world"),
    },
  };

  return { landmarks, terminal, startBytes: startBytes() };
}
