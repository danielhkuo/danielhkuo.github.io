import type { Metadata } from "next";
import dynamic from "next/dynamic";
import HoverMenu from "@/components/HoverMenu";
import Masthead from "@/components/Masthead";
import ProjectCard from "@/components/ProjectCard";
import LiveTime from "@/components/LiveTime";
import { CopyableText } from "@/components/CopyButton";
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
const LocationMap = dynamic(() => import("@/components/LocationMap"), {
  loading: () => (
    <div className="aspect-video animate-pulse rounded-[1.5rem] border border-divider bg-surface" />
  ),
});
const ContactForm = dynamic(() => import("@/components/ContactForm"), {
  loading: () => (
    <div className="h-64 animate-pulse rounded-[1.5rem] border border-divider bg-surface p-8" />
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
              <VStack gap={0}>
                <Text type="label" className="caps-label text-xs text-accent">
                  Terminal · 01
                </Text>
                <Heading level={2} type="display-2" className="mt-3 font-display leading-tight text-text-primary">
                  /daniel-kuo
                </Heading>
              </VStack>
              <Text type="supporting" className="font-mono text-xs leading-relaxed text-text-muted">
                chmod +x portfolio.sh
              </Text>
            </HStack>

            <div className="paper-panel overflow-hidden rounded-[2rem]">
              <div className="bg-[var(--panel-ink)] p-5 font-mono text-sm leading-[1.7] text-[var(--panel-on)] sm:p-7 lg:p-9">
                <div className="mb-6 flex items-center justify-between gap-3 border-b border-[var(--panel-ink-2)] pb-4">
                  <div className="flex gap-2" aria-hidden>
                    <span className="size-2.5 rounded-full bg-[var(--danger)]" />
                    <span className="size-2.5 rounded-full bg-[var(--warn)]" />
                    <span className="size-2.5 rounded-full bg-[var(--success)]" />
                  </div>
                  <p className="caps-label text-[0.62rem] text-[var(--panel-accent)]">
                    terminal
                  </p>
                </div>

                <div className="grid gap-8 lg:grid-cols-[1.05fr_0.95fr] lg:items-start">
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

                  <pre className="overflow-x-auto rounded-[1rem] border border-[var(--panel-ink-2)] bg-[color-mix(in_srgb,var(--panel-on)_7%,transparent)] p-5 text-xs leading-[1.55] text-[var(--panel-accent)]">
{String.raw`  daniel@rice:~$ ./portfolio.sh

        o
       /|\      build
       / \   =========>   ship

  ping: github.com ........ ok
  ping: houston.local ..... ok
  ping: inbox ............. open

  status: ready`}
                  </pre>
                </div>
              </div>
            </div>
          </section>

          <section id="currently" className="scroll-mt-28 border-t border-divider py-16">
            <Grid columns={{ minWidth: 360, max: 2 }} gap={5} className="xl:items-stretch">
              <div className="paper-panel min-w-0 overflow-hidden rounded-[2.25rem] p-3 sm:p-4">
                <LocationMap
                  city="Houston"
                  state="Texas"
                  country="USA"
                  coordinates={{ lat: 29.7168, lng: -95.4036 }}
                />
              </div>

              <VStack as="aside" gap={0} className="paper-panel min-w-0 overflow-hidden rounded-[2.25rem]">
                <HStack gap={3} wrap="wrap" vAlign="center" className="border-b border-divider p-5 sm:p-6">
                  <LiveTime timezone="America/Chicago" location="" />
                  <CopyableText text="danielhkuo@rice.edu" displayText="danielhkuo@rice.edu" />
                </HStack>

                <pre className="min-h-[360px] flex-1 overflow-auto bg-[var(--panel-ink)] p-4 font-mono text-[0.45rem] leading-[1.08] text-[var(--panel-accent)] sm:p-6 sm:text-[0.56rem] md:text-[0.68rem] xl:text-[0.62rem] 2xl:text-[0.72rem]">
{String.raw`⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣄⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣠⣾⣿⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣼⣿⣿⡟⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣴⡟
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣼⢟⣝⣿⣇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣼⡟⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣠⣾⣿⣴⣭⣝⣿⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣾⡿⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣀⣤⣤⣴⡞⣛⣿⣿⣿⣿⣿⣿⣧⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢠⣿⣿⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣀⣤⣴⣮⣽⣯⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣾⢷⣄⣀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣿⣿⠃⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣠⠴⣖⣋⣽⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣟⣻⡷⢦⣄⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣾⣿⡿⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⣀⣠⣶⣿⣷⢾⣿⣿⣿⣿⣿⣛⣿⢿⣿⣿⣿⣿⣿⣿⣽⣿⣿⠛⣿⣿⣿⣿⣿⣿⣷⡄⠉⢳⣦⣀⠀⠀⠀⠀⢀⡄⠀⠀⠀⢀⣾⣟⣿⠁⠀⠀⠀⠀
⠀⠀⢀⣠⣴⣾⣿⢿⣭⣉⣿⣿⣿⣿⣿⡿⠿⠿⠿⠿⢿⣿⠿⣿⢿⢻⣿⣿⣿⣷⣿⣿⡀⣯⢙⡻⣿⣿⣦⡈⣙⣿⣶⣤⣀⣤⣾⡁⠀⢀⣀⣾⣿⣿⡏⠀⠀⠀⠀⠀
⠰⠿⣿⡿⠿⣟⠻⣶⠉⠿⠟⠉⢉⣉⣤⠤⠶⠶⢤⠀⡀⠙⢀⡈⠎⠊⠃⢻⣿⣿⣿⣿⣿⣿⣾⣿⣿⣿⣿⣧⣼⡿⣿⣿⣿⣿⣿⣿⣿⣿⣿⠟⠃⢻⠀⠀⠀⠀⠀⠀
⠀⠀⠈⠻⠛⠛⠿⠥⠤⠶⠖⠊⠉⠉⠀⠀⠀⠀⠀⠀⠀⠀⠀⠁⠈⠀⠀⢿⠛⠿⣿⣿⣿⢿⡇⠀⠈⠉⠉⠻⠿⣷⣿⣿⣉⠻⡿⢛⣹⠟⠛⠳⣤⣿⣄⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠉⠓⠒⠲⠶⠶⠤⠤⠤⣤⠀⠀⠀⠀⠀⠀⠀⠈⠛⠷⣶⡾⣿⣿⣾⣻⣦⡀⠤⢄⣰⣂⣈⣿⣿⣿⣦⡙⠻⢧⠀⠀⠀⠉⡻⢿⠤⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢸⠂⠰⢦⣤⠽⠦⢤⣄⣀⣀⣀⣀⣲⣿⣿⣷⣹⣧⡙⠿⠿⣿⣿⠋⠛⠺⣿⡿⢷⣾⣇⠀⠀⠀⠈⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣸⠀⠀⡼⠃⠀⠀⠀⠀⠈⠉⠉⠉⠉⠉⢹⣿⣿⣿⣧⡀⠀⠈⠛⠀⠀⠀⣽⣿⣿⣏⣿⡆⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣿⣤⣾⠇⢀⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢻⣿⣿⣿⣧⠀⠀⠀⠀⠀⠺⢻⣿⣿⣧⣽⡿⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢠⣾⡿⣿⣾⣰⢿⣧⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢻⣿⣟⣿⠂⠀⠀⠀⠾⢿⣿⣿⡿⠿⠋⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣠⣾⣿⡀⢈⣿⡿⣫⣿⡇⠀⠀⠀⠀⠀⠀⠀⠀⢀⣴⣾⣿⣿⣧⣤⣤⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣠⣿⠟⢹⡇⠻⣫⣽⡿⢟⣛⣻⡀⠀⠀⠀⠀⠀⠀⣼⣿⠛⠻⢿⣿⣿⣿⡿⢷⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⢀⣀⣤⣤⡾⠛⠁⣠⣼⢿⣿⣵⡤⠴⠚⠋⠉⠀⠀⠀⠀⠀⢀⡴⠯⣌⠻⠿⢮⡭⣸⣿⣧⢾⣧⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠘⠿⢿⣿⣿⣿⡿⠭⠚⠋⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣴⠛⠀⣀⠀⢀⣼⣿⣿⣿⠟⣡⣿⣿⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣰⡟⠀⠀⠀⠀⠀⣼⠃⠛⠛⣡⣾⠟⢛⡁⣧⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣀⣤⠞⣹⡇⢀⠉⠀⠀⠀⢸⣷⣴⠞⠉⢀⣠⡿⠟⠋⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢠⣄⣾⡿⠷⠟⠋⠀⠀⢀⣀⣠⣶⠾⣋⣡⡶⠞⠋⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠸⣿⣿⣶⣶⣶⣶⣶⣛⣋⣉⣩⠶⠟⠋⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠉⠉⠉⠉⠉⠉⠉⠉⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀`}
                </pre>
              </VStack>
            </Grid>
          </section>

          <section id="work" className="scroll-mt-28 border-t border-divider py-16">
            <VStack gap={0} className="mb-10">
              <Text type="label" className="caps-label text-xs text-accent">
                Selected work · 03
              </Text>
              <Heading level={2} type="display-2" className="mt-3 font-display leading-tight text-text-primary">
                Pinned repositories from GitHub.
              </Heading>
            </VStack>
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
            <Grid columns={{ minWidth: 320, max: 2 }} gap={8} className="paper-panel rounded-[2.25rem] p-6 sm:p-8 lg:p-10">
              <VStack gap={0}>
                <Text type="label" className="caps-label text-xs text-accent">
                  Contact · 04
                </Text>
                <Heading level={2} type="display-2" className="mt-3 font-display leading-tight text-text-primary">
                  Send a note.
                </Heading>
              </VStack>
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
