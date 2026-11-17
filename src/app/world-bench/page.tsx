import type { Metadata } from "next";
import WorldBench from "./WorldBench";

export const metadata: Metadata = {
  title: "World bench",
  robots: { index: false },
};

export default function WorldBenchPage() {
  return <WorldBench />;
}
