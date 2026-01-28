"use client";

import { useState } from "react";
import EditorialReadme from "./EditorialReadme";
import { RepoWithReadme } from "@/lib/github";

interface ProjectCardProps {
  project: RepoWithReadme;
}

/**
 * ProjectCard - Compact project preview with expandable README
 *
 * Features:
 * - Thumbnail view showing title, description, and metadata
 * - First ~300 characters of README as preview
 * - Expandable "Read Full Article" button
 * - Smooth accordion transition
 */
export default function ProjectCard({ project }: ProjectCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const updatedDate = new Date(project.updatedAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  // Extract preview text (first ~300 chars, but break at sentence)
  const getPreview = (markdown: string) => {
    // Remove markdown formatting for preview
    const plainText = markdown
      .replace(/#{1,6}\s/g, "") // Remove headers
      .replace(/\*\*(.+?)\*\*/g, "$1") // Remove bold
      .replace(/\*(.+?)\*/g, "$1") // Remove italic
      .replace(/\[(.+?)\]\(.+?\)/g, "$1") // Remove links
      .replace(/`(.+?)`/g, "$1") // Remove code
      .replace(/>\s/g, "") // Remove blockquotes
      .trim();

    // Get first ~300 chars at sentence boundary
    const preview = plainText.slice(0, 300);
    const lastPeriod = preview.lastIndexOf(".");
    const lastQuestion = preview.lastIndexOf("?");
    const lastExclamation = preview.lastIndexOf("!");

    const lastSentence = Math.max(lastPeriod, lastQuestion, lastExclamation);

    if (lastSentence > 150) {
      return plainText.slice(0, lastSentence + 1);
    }

    return preview + "...";
  };

  const preview = getPreview(project.readme);

  return (
    <article className="mb-16 pb-16 border-b border-divider last:border-b-0 last:mb-0 last:pb-0">
      {/* Compact Header */}
      <header className="mb-6">
        <div className="flex items-start justify-between gap-4 mb-3">
          <h3 className="font-serif text-3xl font-light text-ink leading-tight">
            {project.name}
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
          <p className="text-lg text-ink/70 leading-relaxed mb-4">
            {project.description}
          </p>
        )}

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
            Repository ↗
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
      </header>

      {/* Preview Text */}
      <div className="mb-6">
        <p className="text-base leading-relaxed text-ink/70">{preview}</p>
      </div>

      {/* Expand Button */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="group flex items-center gap-2 font-mono text-sm uppercase tracking-wider text-ink hover:text-ink/70 transition-colors"
      >
        <span>{isExpanded ? "Close Article" : "Read Full Article"}</span>
        <span
          className="transition-transform duration-300"
          style={{ transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)" }}
        >
          →
        </span>
      </button>

      {/* Expandable Full README */}
      <div
        className="overflow-hidden transition-all duration-500 ease-in-out"
        style={{
          maxHeight: isExpanded ? "10000px" : "0px",
          opacity: isExpanded ? 1 : 0,
        }}
      >
        <div className="border-t border-divider mt-8 pt-8">
          <EditorialReadme content={project.readme} />
        </div>
      </div>
    </article>
  );
}
