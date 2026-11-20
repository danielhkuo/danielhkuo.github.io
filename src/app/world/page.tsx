import type { Metadata } from "next";
import { fetchPinnedRepos } from "@/lib/github";
import Flight from "./Flight";
import { worldProps } from "./worldProps";

export const metadata: Metadata = {
  title: "Flight · Daniel Kuo",
  robots: { index: false },
};

export default async function WorldPage() {
  // The pinned repos, fetched at build time (as the home page does), stand at the world's landmarks.
  return <Flight {...worldProps(await fetchPinnedRepos())} />;
}
