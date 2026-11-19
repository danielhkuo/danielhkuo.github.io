import type { Metadata } from "next";
import SoundBench from "./SoundBench";

export const metadata: Metadata = {
  title: "World sound bench",
  robots: { index: false },
};

export default function WorldSoundPage() {
  return <SoundBench />;
}
