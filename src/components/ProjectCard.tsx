import EditorialReadme from "./EditorialReadme";
import { RepoWithReadme } from "@/lib/github";

interface ProjectCardProps {
  project: RepoWithReadme;
}

/**
 * ProjectCard - Displays a project as a magazine-style article
 *
 * Features:
 * - Metadata header with monospace typography
 * - README content styled as editorial article
 * - Hairline dividers for visual separation
 */
export default function ProjectCard({ project }: ProjectCardProps) {
  const updatedDate = new Date(project.updatedAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <article className="mb-24 last:mb-0">
      {/* Project Header - Metadata in Monospace */}
      <header className="mb-8">
        <div className="flex items-start justify-between gap-4 mb-4">
          <h2 className="font-serif text-4xl font-light text-ink">
            {project.name}
          </h2>

          {project.primaryLanguage && (
            <div className="flex items-center gap-2">
              <div
                className="w-3 h-3"
                style={{ backgroundColor: project.primaryLanguage.color }}
              />
              <span className="font-mono text-xs uppercase tracking-wider text-ink/50">
                {project.primaryLanguage.name}
              </span>
            </div>
          )}
        </div>

        {/* Metadata Row */}
        <div className="flex items-center gap-6 font-mono text-xs uppercase tracking-wider text-ink/50">
          <time dateTime={project.updatedAt}>{updatedDate}</time>

          {project.stargazerCount > 0 && (
            <span>★ {project.stargazerCount}</span>
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
        </div>

        {/* Description */}
        {project.description && (
          <p className="mt-4 text-lg text-ink/70 leading-relaxed">
            {project.description}
          </p>
        )}
      </header>

      {/* Divider */}
      <div className="border-t border-divider mb-8" />

      {/* README Content - Styled as Editorial Article */}
      <EditorialReadme content={project.readme} />
    </article>
  );
}
