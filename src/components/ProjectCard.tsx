"use client";

import { PinnedRepo } from "@/lib/github";

interface ProjectCardProps {
  project: PinnedRepo;
}

/**
 * ProjectCard - Visual project showcase with stats and language breakdown
 *
 * Features:
 * - Project metadata (name, description, dates)
 * - Visual language breakdown bar chart
 * - GitHub stats (stars, forks)
 * - Links to repository and live demo
 */
export default function ProjectCard({ project }: ProjectCardProps) {
  const updatedDate = new Date(project.updatedAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  // Filter out languages with very small percentages for cleaner display
  const significantLanguages = project.languages.filter(
    (lang) => lang.percentage > 1
  );

  return (
    <article className="mb-16 pb-16 border-b border-divider last:border-b-0 last:mb-0 last:pb-0">
      {/* Project Header */}
      <header className="mb-6">
        <div className="flex items-start justify-between gap-4 mb-3">
          <h3 className="font-serif text-3xl font-light text-ink leading-tight">
            <a
              href={project.url}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-ink/70 transition-colors"
            >
              {project.name}
            </a>
          </h3>

          {project.primaryLanguage && (
            <div className="flex items-center gap-2 shrink-0">
              <div
                className="w-2.5 h-2.5"
                style={{ backgroundColor: project.primaryLanguage.color }}
              />
              <span className="font-mono text-xs uppercase tracking-wider text-ink/50">
                {project.primaryLanguage.name}
              </span>
            </div>
          )}
        </div>

        {/* Description */}
        {project.description && (
          <p className="text-lg text-ink/70 leading-relaxed mb-6">
            {project.description}
          </p>
        )}
      </header>

      {/* Language Breakdown Bar Chart */}
      {significantLanguages.length > 0 && (
        <div className="mb-6">
          <h4 className="font-mono text-xs uppercase tracking-wider text-ink/50 mb-3">
            Language Breakdown
          </h4>

          {/* Horizontal Bar */}
          <div className="flex h-2 mb-3 overflow-hidden">
            {significantLanguages.map((lang, index) => (
              <div
                key={lang.name}
                className="transition-all hover:opacity-80"
                style={{
                  width: `${lang.percentage}%`,
                  backgroundColor: lang.color,
                  marginLeft: index > 0 ? "1px" : "0",
                }}
                title={`${lang.name}: ${lang.percentage.toFixed(1)}%`}
              />
            ))}
          </div>

          {/* Language Legend */}
          <div className="flex flex-wrap gap-4">
            {significantLanguages.map((lang) => (
              <div key={lang.name} className="flex items-center gap-2">
                <div
                  className="w-2 h-2"
                  style={{ backgroundColor: lang.color }}
                />
                <span className="font-mono text-xs text-ink/60">
                  {lang.name}
                  <span className="text-ink/40 ml-1">
                    {lang.percentage.toFixed(1)}%
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Stats and Links */}
      <footer className="flex flex-wrap items-center gap-6 font-mono text-xs uppercase tracking-wider text-ink/50">
        <time dateTime={project.updatedAt}>Updated {updatedDate}</time>

        {project.stargazerCount > 0 && (
          <span className="flex items-center gap-1">
            <span className="text-ink/70">★</span> {project.stargazerCount}
          </span>
        )}

        {project.forkCount > 0 && (
          <span className="flex items-center gap-1">
            <span className="text-ink/70">⑂</span> {project.forkCount}
          </span>
        )}

        <a
          href={project.url}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-ink transition-colors"
        >
          View Repository ↗
        </a>

        {project.homepageUrl && (
          <a
            href={project.homepageUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-ink transition-colors"
          >
            Live Demo ↗
          </a>
        )}
      </footer>
    </article>
  );
}
