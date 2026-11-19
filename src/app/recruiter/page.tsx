import type { Metadata } from "next";
import { Layout, LayoutContent } from "@astryxdesign/core/Layout";
import { Link } from "@astryxdesign/core/Link";
import { Text } from "@astryxdesign/core/Text";
import { PROFILE } from "@/components/terminal/content";
import { SITE_URL, TEXT_PAGE } from "@/lib/site-content";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: `${PROFILE.name} · moved`,
  alternates: { canonical: TEXT_PAGE },
  robots: { index: false },
};

/**
 * The text version used to live here. It is now the page at `TEXT_PAGE`,
 * which is also the terminal, and this address forwards to it. The site is a
 * static export with no server, so the forward is a meta refresh, and the
 * link is there for anything that does not follow one.
 */
export default function Moved() {
  return (
    <Layout
      height="auto"
      contentWidth={640}
      padding={4}
      content={
        <LayoutContent role="main" isScrollable={false}>
          <meta httpEquiv="refresh" content={`0; url=${TEXT_PAGE}`} />
          <Text as="p">
            This page has moved to <Link href={TEXT_PAGE}>the text version</Link>.
          </Text>
        </LayoutContent>
      }
    />
  );
}
