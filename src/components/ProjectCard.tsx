"use client";

import { Card, Grid, VStack, HStack, Badge, Heading, Text, Button } from "@astryxdesign/core";
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
    <Card padding={6} className="overflow-hidden rounded-[2rem] sm:p-8">
      <Grid columns={{ minWidth: 320, max: 2 }} gap={8}>
        <VStack gap={0}>
          <HStack gap={2} wrap="wrap" className="mb-4">
            <Badge variant="neutral" label={`Updated ${updatedDate}`} />
            {project.primaryLanguage && (
              <Badge
                variant="neutral"
                label={
                  <HStack gap={2} vAlign="center" as="span">
                    <span
                      className="size-2 rounded-full"
                      style={{ backgroundColor: project.primaryLanguage.color }}
                      aria-hidden
                    />
                    {project.primaryLanguage.name}
                  </HStack>
                }
              />
            )}
          </HStack>

          <Heading level={3} className="font-display text-[clamp(30px,3.5vw,44px)] font-medium leading-[1.05]">
            <a
              href={project.url}
              target="_blank"
              rel="noopener noreferrer"
              className="decoration-accent/30 underline-offset-8 hover:underline"
            >
              {project.name}
            </a>
          </Heading>

          {project.description && (
            <Text type="large" as="p" color="secondary" className="mt-5 max-w-2xl leading-[1.55]">
              {project.description}
            </Text>
          )}

          <HStack gap={3} wrap="wrap" vAlign="center" className="mt-8">
            {project.stargazerCount > 0 && (
              <Badge variant="neutral" label={`Stars ${project.stargazerCount}`} />
            )}
            {project.forkCount > 0 && (
              <Badge variant="neutral" label={`Forks ${project.forkCount}`} />
            )}
            <Button
              label="Repository ↗"
              variant="secondary"
              href={project.url}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full"
            />
            {project.homepageUrl && (
              <Button
                label="Live ↗"
                variant="primary"
                href={project.homepageUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-full"
              />
            )}
          </HStack>
        </VStack>

        <Card variant="muted" padding={5} className="rounded-[1.5rem]">
          <HStack gap={4} hAlign="between" vAlign="center" className="mb-5">
            <Text type="label" color="secondary" className="text-xs">
              Language mix
            </Text>
            <Text type="label" color="secondary" className="text-[0.68rem]">
              GitHub API
            </Text>
          </HStack>

          {significantLanguages.length > 0 ? (
            <VStack gap={4}>
              {significantLanguages.map((lang) => (
                <VStack gap={0} key={lang.name}>
                  <HStack gap={3} hAlign="between" vAlign="center" className="mb-2 text-sm">
                    <HStack gap={2} vAlign="center" as="span">
                      <span
                        className="size-2 rounded-full"
                        style={{ backgroundColor: lang.color }}
                        aria-hidden
                      />
                      <Text type="body" color="primary">
                        {lang.name}
                      </Text>
                    </HStack>
                    <Text type="body" color="secondary" hasTabularNumbers>
                      {lang.percentage.toFixed(1)}%
                    </Text>
                  </HStack>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.max(lang.percentage, 4)}%`,
                        backgroundColor: lang.color,
                      }}
                    />
                  </div>
                </VStack>
              ))}
            </VStack>
          ) : (
            <Text type="body" color="secondary" as="p" className="leading-relaxed">
              No significant language breakdown reported for this repository.
            </Text>
          )}
        </Card>
      </Grid>
    </Card>
  );
}
