import type { Metadata } from "next";
import PhoneTitle from "@/components/title/phone/PhoneTitle";
import { PHONE_TAGLINE, phoneEntries } from "@/components/title/phone/copy";
import { startBytes } from "../world/startBytes";

export const metadata: Metadata = {
  title: "Phone title · Daniel Kuo",
  robots: { index: false },
};

// A bench for the phone's title screen until it has its place at the front door (mobile spec 2): the page a phone
// opens on, with the Recruiter first.
export default function PhoneTitleBench() {
  return <PhoneTitle entries={phoneEntries(startBytes() / 1_000_000)} tagline={PHONE_TAGLINE} selected="recruiter" />;
}
