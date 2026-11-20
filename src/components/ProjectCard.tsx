import { Card, VStack, HStack, Heading, Text } from "@astryxdesign/core";
import FishLayer from "@/components/fish/FishLayer";
import type { Project } from "@/lib/projects";

interface ProjectCardProps {
  project: Project;
}

/** "Sep 8" — the corner date. Year is implied; the full date lives in the shell's `work` view. */
function shortDate(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })} ${d.getUTCDate()}`;
}

/**
 * A compact project card: language and date, the name as the loudest thing,
 * two lines of summary, the language mix as one segmented rule, then
 * stars/forks and the links as plain text. Three fit in a row.
 *
 * Left alone, the card turns into its project's fish (see fish/tank.ts). The
 * fish-* classes are that feature's hooks: the layer the fish is drawn on, the
 * copy that fades out, and the name, which stays.
 */
export default function ProjectCard({ project }: ProjectCardProps) {
  const github = project.github;
  const language = github?.language ?? null;
  const languages = (github?.languages ?? []).filter((lang) => lang.percentage > 1);
  const href = project.repoUrl ?? project.link;

  return (
    <Card padding={5} className="fish-card reveal h-full">
      <FishLayer name={project.slug} />
      <VStack gap={3} height="100%" className="fish-copy">
        <HStack gap={2} hAlign="between" vAlign="center">
          <Text type="supporting" as="span" color="secondary" className="text-[13px]">
            <HStack gap={1.5} vAlign="center" as="span">
              <span
                className="size-2 shrink-0 bg-[var(--border)]"
                style={language ? { backgroundColor: language.color } : undefined}
                aria-hidden
              />
              {language?.name ?? "No language data"}
            </HStack>
          </Text>
          {github ? (
            <Text type="label" as="span" color="secondary" className="caps-label whitespace-nowrap text-[10px]">
              {shortDate(github.updatedAt)}
            </Text>
          ) : null}
        </HStack>

        <Heading level={3} className="fish-name font-display text-[26px] leading-[1.1] [overflow-wrap:anywhere]">
          {href ? (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-text-primary decoration-accent/30 underline-offset-4 hover:underline"
            >
              {project.name}
            </a>
          ) : (
            project.name
          )}
        </Heading>

        <Text type="body" as="p" color="secondary" className="line-clamp-2 min-h-[42px] font-prose text-[13px] leading-[1.5]">
          {project.summary}
        </Text>

        {/* The language mix as proportion: one 4px rule, one segment per language. */}
        <HStack gap={0} className="mt-0.5 h-1 bg-tertiary" aria-hidden>
          {languages.map((lang) => (
            <span key={lang.name} className="h-full" style={{ flex: lang.percentage, backgroundColor: lang.color }} />
          ))}
        </HStack>

        <HStack gap={2} hAlign="between" vAlign="center" className="mt-auto text-[13px]">
          <Text type="supporting" as="span" color="secondary" hasTabularNumbers className="text-[13px]">
            {github && (github.stars > 0 || github.forks > 0) ? `★ ${github.stars} · ⑂ ${github.forks}` : "—"}
          </Text>
          <HStack gap={3} as="span">
            {project.repoUrl && (
              <a href={project.repoUrl} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                Repo ↗
              </a>
            )}
            {project.link && (
              <a href={project.link} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                Live ↗
              </a>
            )}
          </HStack>
        </HStack>
      </VStack>
    </Card>
  );
}
