import type { Metadata } from "next";
import Flight from "./Flight";

export const metadata: Metadata = {
  title: "Flight · Daniel Kuo",
  robots: { index: false },
};

export default function WorldPage() {
  return <Flight />;
}