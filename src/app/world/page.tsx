import type { Metadata } from "next";
import { loadProjects } from "@/lib/projects";
import Flight from "./Flight";
import { worldProps } from "./worldProps";

export const metadata: Metadata = {
  title: "Flight · Daniel Kuo",
  robots: { index: false },
};

export default async function WorldPage() {
  // The projects, read at build time, stand at the world's landmarks.
  return <Flight {...worldProps(await loadProjects())} />;
}
