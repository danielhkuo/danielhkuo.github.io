import { statSync } from "node:fs";
import path from "node:path";
import type { Metadata } from "next";
import PhoneTitle from "@/components/title/phone/PhoneTitle";
import PhoneSwitch from "@/components/title/phone/PhoneSwitch";
import { PHONE_DEFAULT, PHONE_TAGLINE, phoneEntries } from "@/components/title/phone/copy";
import Title from "@/components/title/Title";
import { fetchPinnedRepos } from "@/lib/github";
import { otherPages } from "@/lib/site-content";
import { startBytes } from "./world/startBytes";
import { worldProps } from "./world/worldProps";

export const metadata: Metadata = {
  title: "Daniel Kuo",
  description:
    "Software engineer and Rice CS student building AI products, self-hosted systems, and practical developer tools.",
};

// The front door is the title and nothing else: the desktop one over the world, the phone's own through PhoneSwitch.
export default async function Home() {
  const repos = await fetchPinnedRepos();
  const builtAt = new Date().toISOString();
  const resumeBytes = statSync(path.join(process.cwd(), "public", "Daniel-Kuo-Resume.pdf")).size;

  // Slim, JSON-serializable slice for the client terminal: the directory each
  // repo gets under ~/projects, and the `work` TUI's detail pane.
  const terminalProjects = repos.map((p) => ({
    name: p.name,
    description: p.description,
    url: p.url,
    homepageUrl: p.homepageUrl,
    primaryLanguage: p.primaryLanguage,
    languages: p.languages.map((l) => ({ name: l.name, percentage: l.percentage })),
    stargazerCount: p.stargazerCount,
    forkCount: p.forkCount,
    updatedAt: p.updatedAt,
  }));

  // What the header's `neofetch` prints under Pinned.
  const headerProjects = repos.map((p) => ({
    name: p.name,
    url: p.url,
    language: p.primaryLanguage,
    stars: p.stargazerCount,
    forks: p.forkCount,
  }));

  return (
    <PhoneSwitch phone={<PhoneTitle entries={phoneEntries(startBytes() / 1_000_000)} tagline={PHONE_TAGLINE} selected={PHONE_DEFAULT} />}>
      <Title
        world={worldProps(repos)}
        header={headerProjects}
        shell={{ projects: terminalProjects, site: { builtAt, resumeBytes, pages: otherPages("/") } }}
      />
    </PhoneSwitch>
  );
}
