// Server only: the world's build-time props, shared by /world and the title. Both pages hand Flight the same landmarks
// (the abbey, the hall with every project, and the quest's stops) and the same abbey terminal.

import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { Project } from "@/lib/projects";
import { otherPages } from "@/lib/site-content";
import { landmarksFor, type LandmarkSet } from "@/world/sites/landmarks";
import places from "@/world/story/places.json";
import type { TerminalProps } from "./useTerminalDrawer";
import { startBytes } from "./startBytes";

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
export function worldProps(projects: Project[]): { landmarks: LandmarkSet | null; terminal: TerminalProps; startBytes: number } {
  const manifest = shippedManifest();
  const landmarks: LandmarkSet | null = manifest ? landmarksFor(manifest, projects, places).set : null;

  // The terminal at the abbey gets the projects, and what only the build knows. The site's other pages are among
  // that: given them, its files are the minimal version's (a contact card that stands by itself, where the old home
  // page's pointed at a form this page does not have; ~/sitemap.md; projects/README.md).
  const terminal = {
    projects,
    site: {
      builtAt: new Date().toISOString(),
      resumeBytes: statSync(path.join(process.cwd(), "public", "Daniel-Kuo-Resume.pdf")).size,
      pages: otherPages("/world"),
    },
  };

  return { landmarks, terminal, startBytes: startBytes() };
}
