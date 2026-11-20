import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { Metadata } from "next";
import { loadProjects } from "@/lib/projects";
import { otherPages } from "@/lib/site-content";
import { landmarksFor } from "@/world/sites/landmarks";
import places from "@/world/story/places.json";
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
  // The projects, read at build time: every one is kept in the hall.
  const projects = await loadProjects();
  const manifest = shippedManifest();
  const landmarks = manifest ? landmarksFor(manifest, projects, places).set : null;

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
