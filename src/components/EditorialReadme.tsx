"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useState } from "react";

interface EditorialReadmeProps {
  content: string;
}

/**
 * EditorialReadme - Transforms raw markdown into magazine-quality articles
 *
 * Features:
 * - Applies Editorial typography (Serif headers, generous spacing)
 * - Grayscale image filter that reveals color on hover
 * - Styled links with external indicators
 */
export default function EditorialReadme({ content }: EditorialReadmeProps) {
  return (
    <div className="editorial-content max-w-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Headings - Serif typography
          h1: ({ children }) => (
            <h1 className="font-serif text-4xl font-light mb-8 mt-12 first:mt-0 text-ink">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="font-serif text-3xl font-light mb-6 mt-10 text-ink border-t border-divider pt-6">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="font-serif text-2xl font-light mb-4 mt-8 text-ink">
              {children}
            </h3>
          ),
          h4: ({ children }) => (
            <h4 className="font-serif text-xl font-normal mb-3 mt-6 text-ink">
              {children}
            </h4>
          ),

          // Paragraphs - Generous line height for readability
          p: ({ children }) => (
            <p className="text-lg leading-relaxed mb-6 text-ink/80">
              {children}
            </p>
          ),

          // Images - Grayscale with color reveal on hover
          img: ({ src, alt }) => (
            <EditorialImage src={src} alt={alt} />
          ),

          // Links - Styled with external indicators
          a: ({ href, children }) => {
            const isExternal = href?.startsWith("http");
            return (
              <a
                href={href}
                target={isExternal ? "_blank" : undefined}
                rel={isExternal ? "noopener noreferrer" : undefined}
                className="text-ink underline decoration-1 underline-offset-4 hover:decoration-2 transition-all"
              >
                {children}
                {isExternal && (
                  <span className="inline-block ml-1 text-xs">↗</span>
                )}
              </a>
            );
          },

          // Code blocks - Monospace with paper background
          code: ({ className, children, ...props }) => {
            const isInline = !className;
            if (isInline) {
              return (
                <code className="font-mono text-sm bg-ink/5 px-2 py-0.5 text-ink">
                  {children}
                </code>
              );
            }
            return (
              <code
                className={`font-mono text-sm block bg-ink/5 p-4 overflow-x-auto ${className}`}
                {...props}
              >
                {children}
              </code>
            );
          },

          // Lists - Proper spacing and styling
          ul: ({ children }) => (
            <ul className="list-disc list-inside mb-6 space-y-2 text-ink/80">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal list-inside mb-6 space-y-2 text-ink/80">
              {children}
            </ol>
          ),
          li: ({ children }) => (
            <li className="text-lg leading-relaxed">{children}</li>
          ),

          // Blockquotes - Editorial style
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-ink/20 pl-6 my-6 italic text-ink/70">
              {children}
            </blockquote>
          ),

          // Tables - Clean, minimal styling
          table: ({ children }) => (
            <div className="overflow-x-auto mb-6">
              <table className="w-full border-collapse">
                {children}
              </table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border-b border-divider p-3 text-left font-mono text-sm text-ink">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border-b border-divider/50 p-3 text-ink/80">
              {children}
            </td>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

/**
 * EditorialImage - Grayscale image with color reveal on hover
 */
function EditorialImage({ src, alt }: { src?: string; alt?: string }) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <figure className="my-8">
      <img
        src={src}
        alt={alt || ""}
        className="w-full transition-all duration-300"
        style={{
          filter: isHovered
            ? "grayscale(0%) contrast(1)"
            : "grayscale(100%) contrast(1.1)",
        }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      />
      {alt && (
        <figcaption className="mt-2 font-mono text-xs text-ink/50 text-center">
          {alt}
        </figcaption>
      )}
    </figure>
  );
}
