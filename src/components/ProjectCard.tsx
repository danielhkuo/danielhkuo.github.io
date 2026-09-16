import { Card, VStack, HStack, Heading, Text } from "@astryxdesign/core";
import type { PinnedRepo } from "@/lib/github";

interface ProjectCardProps {
  project: PinnedRepo;
}

/** "Sep 8" — the corner date. Year is implied; the full date lives in the shell's `work` view. */
function shortDate(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })} ${d.getUTCDate()}`;
}

/**
 * A compact repo card: language and date, the name as the loudest thing,
 * two lines of description, the language mix as one segmented rule, then
 * stars/forks and the links as plain text. Three fit in a row.
 */
export default function ProjectCard({ project }: ProjectCardProps) {
  const languages = project.languages.filter((lang) => lang.percentage > 1);
  const hasCounts = project.stargazerCount > 0 || project.forkCount > 0;

  return (
    <Card padding={5} className="h-full">
      <VStack gap={3} height="100%">
        <HStack gap={2} hAlign="between" vAlign="center">
          <Text type="supporting" as="span" color="secondary" className="text-[13px]">
            <HStack gap={1.5} vAlign="center" as="span">
              <span
                className="size-2 shrink-0 bg-[var(--border)]"
                style={project.primaryLanguage ? { backgroundColor: project.primaryLanguage.color } : undefined}
                aria-hidden
              />
              {project.primaryLanguage?.name ?? "No language data"}
            </HStack>
          </Text>
          <Text type="label" as="span" color="secondary" className="caps-label whitespace-nowrap text-[10px]">
            {shortDate(project.updatedAt)}
          </Text>
        </HStack>

        <Heading level={3} className="font-display text-[26px] leading-[1.1] tracking-[-0.01em] [overflow-wrap:anywhere]">
          <a
            href={project.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-text-primary decoration-accent/30 underline-offset-4 hover:underline"
          >
            {project.name}
          </a>
        </Heading>

        <Text type="body" as="p" color="secondary" className="line-clamp-2 min-h-[42px] text-sm leading-[1.5]">
          {project.description}
        </Text>

        {/* The language mix as proportion: one 4px rule, one segment per language. */}
        <HStack gap={0} className="mt-0.5 h-1 bg-tertiary" aria-hidden>
          {languages.map((lang) => (
            <span key={lang.name} className="h-full" style={{ flex: lang.percentage, backgroundColor: lang.color }} />
          ))}
        </HStack>

        <HStack gap={2} hAlign="between" vAlign="center" className="mt-auto text-[13px]">
          <Text type="supporting" as="span" color="secondary" hasTabularNumbers className="text-[13px]">
            {hasCounts ? `★ ${project.stargazerCount} · ⑂ ${project.forkCount}` : "—"}
          </Text>
          <HStack gap={3} as="span">
            <a href={project.url} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
              Repo ↗
            </a>
            {project.homepageUrl && (
              <a href={project.homepageUrl} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                Live ↗
              </a>
            )}
          </HStack>
        </HStack>
      </VStack>
    </Card>
  );
}
