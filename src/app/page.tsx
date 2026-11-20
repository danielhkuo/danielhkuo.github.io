import { statSync } from "node:fs";
import path from "node:path";
import type { Metadata } from "next";
import dynamic from "next/dynamic";
import NeofetchHeader from "@/components/NeofetchHeader";
import ProjectCard from "@/components/ProjectCard";
import TerminalLauncher from "@/components/terminal/TerminalLauncher";
import { loadProjects } from "@/lib/projects";
import { VStack, HStack, Grid, Heading, Text } from "@astryxdesign/core";

export const metadata: Metadata = {
  title: "Daniel Kuo",
  description:
    "Software engineer and Rice CS student building AI products, self-hosted systems, and practical developer tools.",
};

// Lazy load below-the-fold components. The placeholder is in the static HTML,
// so it is the form's first paint: keep it the form's height or the panel
// jumps on load. The form loses a row at 516px, where the submit button fits
// beside the captcha, and another at `sm`, where Name and Email share one.
const ContactForm = dynamic(() => import("@/components/ContactForm"), {
  loading: () => (
    <div className="h-100 animate-pulse border border-divider bg-surface min-[516px]:h-88 sm:h-69" />
  ),
});

export default async function Home() {
  // The projects, read at build time.
  const projects = await loadProjects();

  // What only the build knows, for the terminal's `ls -l`: when this ran, and
  // the size of the résumé that ~/resume.pdf stands for.
  const site = {
    builtAt: new Date().toISOString(),
    resumeBytes: statSync(path.join(process.cwd(), "public", "Daniel-Kuo-Resume.pdf")).size,
  };

  // What the header's `neofetch` prints under Pinned.
  const headerProjects = projects.flatMap((p) => {
    const url = p.repoUrl ?? p.link;
    if (!url) return [];
    return [
      {
        name: p.name,
        url,
        language: p.github?.language ?? null,
        stars: p.github?.stars ?? 0,
        forks: p.github?.forks ?? 0,
      },
    ];
  });

  return (
    <VStack gap={0} width="100%" height="100%" className="min-h-screen bg-bg text-text-primary">
      <NeofetchHeader projects={headerProjects} />

      <main className="mx-auto w-full max-w-6xl px-5 pb-20 sm:px-8 lg:px-10">
        <VStack gap={0}>
          {/* No heading: the repos announce themselves. Three compact cards
              to a row; the full language breakdown lives in the shell's
              `work` view. */}
          <section id="work" className="border-t border-divider pt-10 pb-16">
            {projects.length > 0 ? (
              <Grid columns={{ minWidth: 276 }} gap={5} className="items-stretch">
                {projects.map((project) => (
                  <ProjectCard key={project.slug} project={project} />
                ))}
              </Grid>
            ) : (
              <Text type="body" className="text-sm text-ink">
                No pinned repositories found. Add a GITHUB_TOKEN to fetch real projects.
              </Text>
            )}
          </section>

          {/* A closing note, not a second hero: one narrow panel on the cards'
              left edge, about the size of two of them. */}
          <section id="contact" className="border-t border-divider py-10">
            <VStack gap={4} padding={6} className="paper-panel reveal max-w-xl">
              <Heading level={2} type="display-3" className="font-display leading-tight text-text-primary">
                Send a note.
              </Heading>
              <ContactForm />
            </VStack>
          </section>
        </VStack>
      </main>

      <footer className="mt-32 border-t border-divider">
        <HStack
          gap={3}
          wrap="wrap"
          vAlign="center"
          className="reveal mx-auto max-w-6xl justify-between px-5 py-10 sm:px-8 lg:px-10"
        >
          <Text type="label" className="caps-label text-xs text-text-muted">
            <span suppressHydrationWarning>© {new Date().getFullYear()} · Daniel Kuo</span>
          </Text>
          <Text type="label" className="caps-label text-xs text-text-muted">
            Houston TX · Rice CS
          </Text>
        </HStack>
      </footer>

      <TerminalLauncher projects={projects} site={site} />
    </VStack>
  );
}
