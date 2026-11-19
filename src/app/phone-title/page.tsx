import type { Metadata } from "next";
import PhoneTitle from "@/components/title/phone/PhoneTitle";
import { PHONE_DEFAULT, PHONE_TAGLINE, phoneEntries } from "@/components/title/phone/copy";
import { startBytes } from "../world/startBytes";

export const metadata: Metadata = {
  title: "Phone title · Daniel Kuo",
  robots: { index: false },
};

// The phone's title screen on its own noindex bench (mobile spec 2), until the front door takes it together with the
// desktop title through PhoneSwitch: the page a phone will open on, with the minimal version first.
export default function PhoneTitleBench() {
  return <PhoneTitle entries={phoneEntries(startBytes() / 1_000_000)} tagline={PHONE_TAGLINE} selected={PHONE_DEFAULT} />;
}
