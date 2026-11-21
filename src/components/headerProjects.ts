// The rows under "Projects" in the title window's `neofetch`. Pure, with no React, so the page and the tests share
// one rule: a project the build has no GitHub stats for keeps its name and its one line, and never stands in for
// them with "n/a" and zero counts.

import type { Project } from "../lib/projects.ts";

/** The window lists at most this many: the first by order. */
export const HEADER_PROJECTS = 6;

/**
 * One of those rows, handed from the server page to the header. `stats` stays null when the build learned nothing
 * from GitHub — every build without a token, and every project that names no repository.
 */
export interface HeaderProject {
  name: string;
  /** The repository's page, else the project's link, else null. The project is still listed. */
  url: string | null;
  /** Its one line. */
  summary: string;
  /** From GitHub. Null when `github` is null. */
  stats: { language: { name: string; color: string } | null; stars: number; forks: number } | null;
}

/** The first `HEADER_PROJECTS`, in the order given. The caller has already sorted them. */
export function headerProjects(projects: readonly Project[]): HeaderProject[] {
  return projects.slice(0, HEADER_PROJECTS).map((project) => ({
    name: project.name,
    url: project.repoUrl ?? project.link,
    summary: project.summary,
    // A missing `github` is not zero stars. A repository GitHub lists with no language still has its counts.
    stats:
      project.github === null
        ? null
        : { language: project.github.language, stars: project.github.stars, forks: project.github.forks },
  }));
}
