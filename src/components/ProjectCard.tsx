"use client";

import { PinnedRepo } from "@/lib/github";

interface ProjectCardProps {
  project: PinnedRepo;
}

export default function ProjectCard({ project }: ProjectCardProps) {
  const updatedDate = new Date(project.updatedAt)
    .toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    })
    .toUpperCase();

  const significantLanguages = project.languages.filter(
    (lang) => lang.percentage > 1,
  );

  return (
    <article className="group paper-panel overflow-hidden rounded-[2rem] p-6 hover:shadow-md sm:p-8">
      <div className="grid gap-8 lg:grid-cols-[1.12fr_0.88fr]">
        <div>
          <header>
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <span className="caps-label rounded-full border border-divider bg-bg px-3 py-1.5 text-[0.68rem] text-text-muted">
                Updated {updatedDate}
              </span>
              {project.primaryLanguage && (
                <span className="caps-label inline-flex items-center gap-2 rounded-full border border-divider bg-bg px-3 py-1.5 text-[0.68rem] text-text-primary">
                  <span
                    className="size-2 rounded-full"
                    style={{ backgroundColor: project.primaryLanguage.color }}
                    aria-hidden
                  />
                  {project.primaryLanguage.name}
                </span>
              )}
            </div>

            <h3 className="font-display text-4xl font-medium leading-tight text-text-primary md:text-5xl">
              <a
                href={project.url}
                target="_blank"
                rel="noopener noreferrer"
                className="decoration-primary/30 underline-offset-8 hover:text-accent hover:underline"
              >
                {project.name}
              </a>
            </h3>

            {project.description && (
              <p className="mt-5 max-w-2xl text-lg leading-[1.55] text-text-secondary">
                {project.description}
              </p>
            )}
          </header>

          <footer className="mt-8 flex flex-wrap items-center gap-3">
            {project.stargazerCount > 0 && (
              <span className="caps-label rounded-full border border-divider bg-bg px-3 py-1.5 text-[0.68rem] text-text-muted">
                Stars {project.stargazerCount}
              </span>
            )}
            {project.forkCount > 0 && (
              <span className="caps-label rounded-full border border-divider bg-bg px-3 py-1.5 text-[0.68rem] text-text-muted">
                Forks {project.forkCount}
              </span>
            )}
            <a
              href={project.url}
              target="_blank"
              rel="noopener noreferrer"
              className="capsule-shell inline-flex items-center rounded-full px-4 py-2 font-caps text-xs tracking-[var(--tracking-label)] text-text-primary hover:border-primary hover:shadow-md"
            >
              Repository ↗
            </a>
            {project.homepageUrl && (
              <a
                href={project.homepageUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex rounded-full bg-primary px-4 py-2 font-caps text-xs tracking-[var(--tracking-label)] text-[var(--accent-on)] shadow-sm hover:shadow-md"
              >
                Live ↗
              </a>
            )}
          </footer>
        </div>

        <div className="rounded-[1.5rem] border border-divider bg-bg/60 p-5">
          <div className="mb-5 flex items-center justify-between gap-4">
            <p className="caps-label text-xs text-text-muted">Language mix</p>
            <p className="caps-label text-[0.68rem] text-text-muted">GitHub API</p>
          </div>

          {significantLanguages.length > 0 ? (
            <div className="space-y-4">
              {significantLanguages.map((lang) => (
                <div key={lang.name}>
                  <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                    <span className="flex items-center gap-2 text-text-primary">
                      <span
                        className="size-2 rounded-full"
                        style={{ backgroundColor: lang.color }}
                        aria-hidden
                      />
                      {lang.name}
                    </span>
                    <span className="tabular-nums text-text-muted">
                      {lang.percentage.toFixed(1)}%
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full border border-divider bg-surface">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.max(lang.percentage, 4)}%`,
                        backgroundColor: lang.color,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm leading-relaxed text-text-muted">
              No significant language breakdown reported for this repository.
            </p>
          )}
        </div>
      </div>
    </article>
  );
}
