import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { Metadata } from "next";
import { fetchPinnedRepos, type PinnedRepo } from "@/lib/github";
import { otherPages } from "@/lib/site-content";
import { landmarksFor, type HallProject } from "@/world/sites/landmarks";
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

/** "owner/name" from a github.com repository URL. */
function repoOf(url: string): string | null {
  const at = url.indexOf("github.com/");
  if (at < 0) return null;
  const [owner, name] = url.slice(at + "github.com/".length).split("/");
  if (!owner || !name) return null;
  const clean = name.split(/[?#]/)[0]?.replace(/\.git$/, "");
  return clean ? `${owner}/${clean}` : null;
}

/** The pinned repos as the hall's projects. Replaced by loadProjects() when world/projects lands. */
function hallProjects(repos: PinnedRepo[]): HallProject[] {
  return repos.map((r, order) => ({
    slug: r.name,
    name: r.name,
    summary: r.description,
    body: "",
    order,
    repo: repoOf(r.url),
    repoUrl: r.url,
    link: r.homepageUrl || null,
    image: null,
    github: {
      stars: r.stargazerCount,
      forks: r.forkCount,
      language: r.primaryLanguage,
      languages: r.languages,
      updatedAt: r.updatedAt,
    },
  }));
}

export default async function WorldPage() {
  // The pinned repos, fetched at build time, fill the hall until loadProjects() lands.
  const repos = await fetchPinnedRepos();
  const manifest = shippedManifest();
  const landmarks = manifest ? landmarksFor(manifest, hallProjects(repos), places).set : null;

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

  return <Flight landmarks={landmarks} terminal={terminal} startBytes={startBytes()} />;
}
