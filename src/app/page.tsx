import { statSync } from "node:fs";
import path from "node:path";
import type { Metadata } from "next";
import PhoneTitle from "@/components/title/phone/PhoneTitle";
import PhoneSwitch from "@/components/title/phone/PhoneSwitch";
import { PHONE_DEFAULT, PHONE_TAGLINE, phoneEntries } from "@/components/title/phone/copy";
import { headerProjects } from "@/components/headerProjects";
import Title from "@/components/title/Title";
import { loadProjects } from "@/lib/projects";
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
  // The projects, read at build time, lowest order first.
  const projects = await loadProjects();
  const builtAt = new Date().toISOString();
  const resumeBytes = statSync(path.join(process.cwd(), "public", "Daniel-Kuo-Resume.pdf")).size;

  return (
    <PhoneSwitch phone={<PhoneTitle entries={phoneEntries(startBytes() / 1_000_000)} tagline={PHONE_TAGLINE} selected={PHONE_DEFAULT} />}>
      <Title
        world={worldProps(projects)}
        header={headerProjects(projects)}
        shell={{ projects, site: { builtAt, resumeBytes, pages: otherPages("/") } }}
      />
    </PhoneSwitch>
  );
}
