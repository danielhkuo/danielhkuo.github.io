import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { Metadata } from "next";
import { fetchPinnedRepos } from "@/lib/github";
import { LANDMARK_CONFIG } from "@/world/landmarks.config";
import sticky from "@/world/sites/assignments.json";
import { entryOf, landmarksFor, stickyText, type LandmarkSet } from "@/world/sites/landmarks";
import Flight from "./Flight";

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

/**
 * Bytes the flight fetches before its first view: the manifest, the core, and the 2 × 2 regions round the start (the
 * phone's "before you fly" card states it). 0 when the world files are absent or in another format.
 */
function startBytes(): number {
  try {
    const dir = path.join(process.cwd(), "public", "world");
    const { worldId } = JSON.parse(readFileSync(path.join(dir, "current.json"), "utf8")) as { worldId: string };
    const root = path.join(dir, worldId);
    const m = JSON.parse(readFileSync(path.join(root, "manifest.json"), "utf8")) as { n: number; regionCells?: number; start: { x: number; y: number } };
    let bytes = statSync(path.join(root, "manifest.json")).size + statSync(path.join(root, "core.bin")).size;
    if (m.regionCells) {
      const per = Math.round(m.n / m.regionCells);
      const rx = Math.floor(m.start.x / m.regionCells - 0.5);
      const ry = Math.floor(m.start.y / m.regionCells - 0.5);
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const file = path.join(root, "regions", `${(((rx + dx) % per) + per) % per}-${(((ry + dy) % per) + per) % per}.bin`);
        try {
          bytes += statSync(file).size;
        } catch {
          // a region the build left out: it is not fetched either
        }
      }
    }
    return bytes;
  } catch {
    return 0;
  }
}

export default async function WorldPage() {
  // The pinned repos, fetched at build time (as the home page does), stand at the world's landmarks.
  const repos = await fetchPinnedRepos();
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

  // The terminal at the abbey gets what the home page's gets: a slim slice of each repo, and what only the build knows.
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
    },
  };

  return <Flight landmarks={landmarks} terminal={terminal} startBytes={startBytes()} />;
}
