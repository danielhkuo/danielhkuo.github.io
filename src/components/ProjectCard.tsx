"use client";

import { PinnedRepo } from "@/lib/github";
import { generateTornPolygon, pickCardVariant } from "@/lib/tornEdge";

interface ProjectCardProps {
  project: PinnedRepo;
}

/**
 * ProjectCard — torn-paper "fragment" silhouette per design.md.
 * The outer wrapper carries the unique clip-path; inner article holds content.
 */
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

  const clipPath = generateTornPolygon(project.name);
  const variant = pickCardVariant(project.name);

  return (
    <div
      className="mb-16 last:mb-0"
      style={{
        transform: `rotate(${variant.rotation.toFixed(3)}deg)`,
        filter:
          "drop-shadow(0 6px 20px color-mix(in srgb, #555879 20%, transparent))",
      }}
    >
      <div
        style={{
          clipPath,
          backgroundColor: `var(${variant.surface})`,
          padding: "3.5rem 3rem",
        }}
      >
        <article>
          <header className="mb-6">
            <div className="flex items-start justify-between gap-4 mb-3">
              <h3
                className="text-3xl leading-tight"
                style={{
                  fontFamily: "var(--font-cormorant), serif",
                  fontWeight: 500,
                  color: "var(--text-primary)",
                }}
              >
                <a
                  href={project.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="transition-opacity duration-200 ease-out hover:opacity-70"
                >
                  {project.name}
                </a>
              </h3>

              {project.primaryLanguage && (
                <div className="flex items-center gap-2 shrink-0">
                  <span
                    className="size-2.5"
                    style={{ backgroundColor: project.primaryLanguage.color }}
                    aria-hidden
                  />
                  <span
                    className="text-xs uppercase"
                    style={{
                      fontFamily: "var(--font-cormorant-sc), serif",
                      letterSpacing: "0.15em",
                      color: "var(--text-muted)",
                    }}
                  >
                    [ {project.primaryLanguage.name} ]
                  </span>
                </div>
              )}
            </div>

            <div
              className="text-xs uppercase mb-4"
              style={{
                fontFamily: "var(--font-cormorant-sc), serif",
                letterSpacing: "0.25em",
                color: "var(--text-muted)",
              }}
            >
              [ UPDATED {updatedDate} ]
            </div>

            {project.description && (
              <p
                className="text-lg"
                style={{
                  fontFamily: "var(--font-eb), Georgia, serif",
                  lineHeight: 1.7,
                  color: "var(--text-secondary)",
                }}
              >
                {project.description}
              </p>
            )}
          </header>

          {significantLanguages.length > 0 && (
            <div className="mb-6 flex flex-wrap gap-x-5 gap-y-2">
              {significantLanguages.map((lang) => (
                <span
                  key={lang.name}
                  className="inline-flex items-center gap-2"
                >
                  <span
                    className="size-1.5"
                    style={{ backgroundColor: lang.color }}
                    aria-hidden
                  />
                  <span
                    className="text-xs uppercase"
                    style={{
                      fontFamily: "var(--font-cormorant-sc), serif",
                      letterSpacing: "0.2em",
                      color: "var(--text-muted)",
                    }}
                  >
                    [ {lang.name} ]
                  </span>
                </span>
              ))}
            </div>
          )}

          <footer
            className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs uppercase"
            style={{
              fontFamily: "var(--font-cormorant-sc), serif",
              letterSpacing: "0.2em",
              color: "var(--text-muted)",
            }}
          >
            {project.stargazerCount > 0 && (
              <span>[ ★ {project.stargazerCount} ]</span>
            )}
            {project.forkCount > 0 && (
              <span>[ ⑂ {project.forkCount} ]</span>
            )}
            <a
              href={project.url}
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors duration-200 ease-out"
              style={{ color: "var(--text-secondary)" }}
            >
              [ REPOSITORY ↗ ]
            </a>
            {project.homepageUrl && (
              <a
                href={project.homepageUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="transition-colors duration-200 ease-out"
                style={{ color: "var(--text-secondary)" }}
              >
                [ LIVE ↗ ]
              </a>
            )}
          </footer>
        </article>
      </div>
    </div>
  );
}
