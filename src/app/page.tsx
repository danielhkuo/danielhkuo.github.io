import type { Metadata } from "next";
import dynamic from "next/dynamic";
import HoverMenu from "@/components/HoverMenu";
import Masthead from "@/components/Masthead";
import ProjectCard from "@/components/ProjectCard";
import TerminalLauncher from "@/components/terminal/TerminalLauncher";
import ShellHint from "@/components/terminal/ShellHint";
import { fetchPinnedRepos } from "@/lib/github";
import { VStack, HStack, Grid, Heading, Text } from "@astryxdesign/core";

export const metadata: Metadata = {
  title: "Daniel Kuo",
  description:
    "Software engineer and Rice CS student building AI products, self-hosted systems, and practical developer tools.",
};

// Lazy load below-the-fold components
const ContactForm = dynamic(() => import("@/components/ContactForm"), {
  loading: () => (
    <div className="h-64 animate-pulse border border-divider bg-surface p-8" />
  ),
});

export default async function Home() {
  // Fetch pinned repos at build time (SSG)
  const projects = await fetchPinnedRepos();

  // Slim, JSON-serializable slice for the client terminal.
  const terminalProjects = projects.map((p) => ({
    name: p.name,
    description: p.description,
    url: p.url,
    homepageUrl: p.homepageUrl,
  }));

  return (
    <VStack gap={0} width="100%" height="100%" className="min-h-screen bg-bg text-text-primary">
      <HoverMenu />

      <Masthead />

      <main className="mx-auto w-full max-w-6xl px-5 pb-20 sm:px-8 lg:px-10">
        <VStack gap={0}>
          <section id="about" className="scroll-mt-28 py-14 md:py-24">
            <HStack gap={3} vAlign="end" wrap="wrap" className="mb-6 justify-between">
              <Heading level={2} type="display-2" className="font-display text-[clamp(30px,4vw,44px)] font-medium leading-[1.05] text-text-primary">
                /daniel-kuo
              </Heading>
              <Text type="supporting" className="font-mono text-xs leading-relaxed text-text-muted">
                chmod +x portfolio.sh
              </Text>
            </HStack>

            <div className="paper-panel overflow-hidden">
              <div className="ink-panel bg-[var(--panel-ink)] p-5 font-mono text-sm leading-[1.7] sm:p-7 lg:p-9">
                {/* Same macOS traffic lights as the interactive window — real
                    Apple hues, not the theme's danger/warn/success. */}
                <div className="mb-6 flex items-center justify-between gap-3 border-b border-[var(--panel-ink-2)] pb-4">
                  <div className="term-lights flex gap-2" aria-hidden>
                    <span />
                    <span />
                    <span />
                  </div>
                  <p className="caps-label text-[0.62rem] text-[var(--panel-accent)]">
                    terminal
                  </p>
                </div>

                <div className="space-y-5">
                  <div>
                    <p className="text-[var(--panel-accent)]">$ whoami</p>
                    <p>Daniel Kuo / Rice CS / Houston</p>
                  </div>
                  <div>
                    <p className="text-[var(--panel-accent)]">$ current --role</p>
                    <p>Incoming Engineering Summer Analyst @ Goldman Sachs AWM</p>
                  </div>
                  <div>
                    <p className="text-[var(--panel-accent)]">$ shipped --themes</p>
                    <p>AI mobile apps / GitHub project surfaces / homelab services / Labshare ops</p>
                  </div>
                  <div>
                    <p className="text-[var(--panel-accent)]">$ keep</p>
                    <p>Useful products. Ethical AI. Open source. Clean systems. Fewer words.</p>
                  </div>
                  <ShellHint />
                </div>
              </div>
            </div>
          </section>

          <section id="work" className="scroll-mt-28 border-t border-divider py-16">
            <Heading level={2} type="display-2" className="mb-10 font-display text-[clamp(30px,4vw,44px)] font-medium leading-[1.05] text-text-primary">
              Pinned repositories from GitHub.
            </Heading>
            <VStack gap={6}>
              {projects.length > 0 ? (
                projects.map((project) => (
                  <ProjectCard key={project.name} project={project} />
                ))
              ) : (
                <Text type="body" className="font-mono text-sm text-ink">
                  No pinned repositories found. Add a GITHUB_TOKEN to fetch real projects.
                </Text>
              )}
            </VStack>
          </section>

          <section id="contact" className="scroll-mt-28 border-t border-divider py-16">
            <Grid columns={{ minWidth: 280, repeat: "fit" }} gap={8} className="paper-panel p-6 sm:p-8 lg:p-10">
              <Heading level={2} type="display-2" className="font-display text-[clamp(30px,4vw,44px)] font-medium leading-[1.05] text-text-primary">
                Send a note.
              </Heading>
              <ContactForm />
            </Grid>
          </section>
        </VStack>
      </main>

      <footer className="mt-32 border-t border-divider">
        <HStack
          gap={3}
          wrap="wrap"
          vAlign="center"
          className="mx-auto max-w-6xl justify-between px-5 py-10 sm:px-8 lg:px-10"
        >
          <Text type="label" className="caps-label text-xs text-text-muted">
            <span suppressHydrationWarning>© {new Date().getFullYear()} · Daniel Kuo</span>
          </Text>
          <Text type="label" className="caps-label text-xs text-text-muted">
            Houston TX · Rice CS
          </Text>
        </HStack>
      </footer>

      <TerminalLauncher projects={terminalProjects} />
    </VStack>
  );
}
