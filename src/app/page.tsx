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
    <div className="min-h-screen bg-bg text-text-primary">
      <HoverMenu />

      <Masthead />

      <main className="mx-auto max-w-6xl px-5 pb-20 sm:px-8 lg:px-10">
        <section id="about" className="scroll-mt-28 py-14 md:py-24">
          <div className="mb-6 flex flex-col justify-between gap-3 md:flex-row md:items-end">
            <div>
              <p className="caps-label text-xs text-accent">Terminal · 01</p>
              <h2 className="mt-3 font-display text-4xl font-medium leading-tight text-text-primary md:text-5xl">
                /daniel-kuo
              </h2>
            </div>
            <p className="font-mono text-xs leading-relaxed text-text-muted">
              chmod +x portfolio.sh
            </p>
          </div>

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
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)] xl:items-stretch">
            <div className="paper-panel min-w-0 overflow-hidden rounded-[2.25rem] p-3 sm:p-4">
              <LocationMap
                city="Houston"
                state="Texas"
                country="USA"
                coordinates={{ lat: 29.7168, lng: -95.4036 }}
              />
            </div>

            <aside className="paper-panel flex min-w-0 flex-col overflow-hidden rounded-[2.25rem]">
              <div className="flex flex-wrap items-center gap-3 border-b border-divider p-5 sm:p-6">
                <LiveTime timezone="America/Chicago" location="" />
                <CopyableText text="danielhkuo@rice.edu" displayText="danielhkuo@rice.edu" />
              </div>

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
            </aside>
          </div>
        </section>

        <section id="work" className="scroll-mt-28 border-t border-divider py-16">
          <div className="mb-10 flex flex-col justify-between gap-5 md:flex-row md:items-end">
            <div>
              <p className="caps-label text-xs text-accent">Selected work · 03</p>
              <h2 className="mt-3 font-display text-4xl font-medium leading-tight text-text-primary md:text-5xl">
                Pinned repositories from GitHub.
              </h2>
            </div>
          </div>
          <div className="grid gap-6">
            {projects.length > 0 ? (
              projects.map((project) => (
                <ProjectCard key={project.name} project={project} />
              ))
            ) : (
              <p className="font-mono text-sm text-ink">
                No pinned repositories found. Add a GITHUB_TOKEN to fetch real projects.
              </p>
            )}
          </div>
        </section>

        <section id="contact" className="scroll-mt-28 border-t border-divider py-16">
          <div className="paper-panel grid gap-8 rounded-[2.25rem] p-6 sm:p-8 lg:grid-cols-[0.85fr_1.15fr] lg:p-10">
            <div>
              <p className="caps-label text-xs text-accent">Contact · 04</p>
              <h2 className="mt-3 font-display text-4xl font-medium leading-tight text-text-primary md:text-5xl">
                Send a note.
              </h2>
            </div>
            <ContactForm />
          </div>
        </section>

      </main>

      <footer className="border-t border-divider mt-32">
        <div className="mx-auto flex max-w-6xl flex-col justify-between gap-3 px-5 py-10 sm:px-8 md:flex-row lg:px-10">
          <p className="caps-label text-xs text-text-muted" suppressHydrationWarning>
            © {new Date().getFullYear()} · Daniel Kuo
          </p>
          <p className="caps-label text-xs text-text-muted">
            Houston TX · Rice CS
          </p>
        </div>
      </footer>

      <TerminalLauncher projects={terminalProjects} />
    </div>
  );
}
