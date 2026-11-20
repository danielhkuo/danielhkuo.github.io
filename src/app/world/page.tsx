import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { Metadata } from "next";
import { loadProjects } from "@/lib/projects";
import { otherPages } from "@/lib/site-content";
import { LANDMARK_CONFIG } from "@/world/landmarks.config";
import sticky from "@/world/sites/assignments.json";
import { entryOf, landmarksFor, stickyText, type LandmarkSet } from "@/world/sites/landmarks";
import Flight from "./Flight";
import { startBytes } from "./startBytes";

export const metadata: Metadata = {
  title: "Flight · Daniel Kuo",
  robots: { index: false },
};

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

export default async function WorldPage() {
  // The projects, read at build time, stand at the world's landmarks.
  const projects = await loadProjects();
  const manifest = shippedManifest();
  let landmarks: LandmarkSet | null = null;
  if (manifest) {
    const placed = landmarksFor(manifest, projects.map(entryOf), LANDMARK_CONFIG, sticky);
    landmarks = placed.set;
    // A build from other project files, such as the e2e fixtures, has no place in the committed file.
    if (placed.changed && !process.env.PROJECTS_DIR) {
      console.warn(
        `world: the projects at the landmarks have changed. Commit this as src/world/sites/assignments.json:\n${stickyText(manifest.worldId, placed.bySite)}`,
      );
    }
  }

  // The terminal at the abbey gets the projects, and what only the build knows. The site's other pages are
  // among that: given them, its files are the minimal version's (a contact card that stands by itself, where the old
  // home page's pointed at a form this page does not have; ~/sitemap.md; projects/README.md).
  const terminal = {
    projects,
    site: {
      builtAt: new Date().toISOString(),
      resumeBytes: statSync(path.join(process.cwd(), "public", "Daniel-Kuo-Resume.pdf")).size,
      pages: otherPages("/world"),
    },
  };

  return <Flight landmarks={landmarks} terminal={terminal} startBytes={startBytes()} />;
}
