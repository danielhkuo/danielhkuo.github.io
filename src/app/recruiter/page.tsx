import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Layout, LayoutContent, LayoutFooter, LayoutHeader } from "@astryxdesign/core/Layout";
import { Heading } from "@astryxdesign/core/Heading";
import { Link } from "@astryxdesign/core/Link";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { LINKS, PROFILE } from "@/components/terminal/content";
import { loadPinnedRepos } from "@/lib/github";
import {
  SITE_PAGES,
  SITE_URL,
  bareUrl,
  contactLinks,
  profileFacts,
  profileSummary,
  projectFacts,
  publishedProjects,
  withScheme,
} from "@/lib/site-content";

const PATH = "/recruiter";

/** One label track for every key-value list, so About's and Contact's values share a left edge. */
const LABEL_TRACK = { position: "start", width: 96 } as const;

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: `${PROFILE.name} · ${PROFILE.title}`,
  description: profileSummary(),
  alternates: { canonical: PATH },
  openGraph: { type: "profile", url: PATH, title: PROFILE.name, description: profileSummary() },
};

/** A titled part of the page: a <section> named by its heading, which is also its #anchor. */
function Part({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <VStack as="section" aria-labelledby={id} gap={4}>
      <Heading level={2} id={id}>
        {title}
      </Heading>
      {children}
    </VStack>
  );
}

/**
 * The whole site as one plain page: who Daniel is, what has been made and
 * where to get in touch, generated from content.ts and the pinned repos like
 * every other view. Text only and server-rendered, so it reads the same to a
 * phone, a screen reader, a crawler and a printer.
 */
export default async function TextVersion() {
  const projects = publishedProjects(await loadPinnedRepos());
  const elsewhere = SITE_PAGES.filter((page) => page.path !== PATH);

  return (
    <Layout
      height="auto"
      contentWidth={640}
      padding={4}
      header={
        <LayoutHeader role="banner">
          <VStack gap={1} paddingBlockStart={6}>
            <Heading level={1}>{PROFILE.name}</Heading>
            <Text type="large" color="secondary">
              {PROFILE.title}
            </Text>
          </VStack>
        </LayoutHeader>
      }
      content={
        <LayoutContent role="main" isScrollable={false}>
          <VStack gap={10} paddingBlock={6}>
            <Part id="about" title="About">
              <MetadataList label={LABEL_TRACK}>
                {profileFacts().map((fact) => (
                  <MetadataListItem key={fact.label} label={fact.label}>
                    {fact.value}
                  </MetadataListItem>
                ))}
              </MetadataList>
            </Part>

            <Part id="contact" title="Contact">
              <MetadataList label={LABEL_TRACK}>
                {contactLinks().map((contact) => (
                  <MetadataListItem key={contact.label} label={contact.label}>
                    <Link href={contact.href}>{contact.text}</Link>
                  </MetadataListItem>
                ))}
              </MetadataList>
            </Part>

            <Part id="projects" title="Projects">
              {projects.length > 0 ? (
                <VStack as="ul" role="list" gap={6}>
                  {projects.map((project) => (
                    <VStack as="li" key={project.url} gap={1}>
                      <Heading level={3}>
                        <Link href={project.url} type="inherit">
                          {project.name}
                        </Link>
                      </Heading>
                      {project.description && <Text as="p">{project.description}</Text>}
                      <Text as="p" type="supporting">
                        {projectFacts(project)}
                      </Text>
                      {project.homepageUrl && (
                        <Text as="p">
                          <Link href={withScheme(project.homepageUrl)}>{bareUrl(project.homepageUrl)}</Link>
                        </Text>
                      )}
                    </VStack>
                  ))}
                </VStack>
              ) : (
                <Text as="p">
                  The projects are pinned on <Link href={LINKS.github}>{bareUrl(LINKS.github)}</Link>.
                </Text>
              )}
            </Part>

            <Part id="elsewhere" title="Elsewhere on this site">
              <VStack as="ul" role="list" gap={4}>
                {elsewhere.map((page) => (
                  <VStack as="li" key={page.title} gap={0.5}>
                    <Link href={page.path} isStandalone>
                      {page.title}
                    </Link>
                    <Text as="p" color="secondary">
                      {page.summary}
                    </Text>
                  </VStack>
                ))}
              </VStack>
            </Part>
          </VStack>
        </LayoutContent>
      }
      footer={
        <LayoutFooter role="contentinfo" hasDivider>
          <Text type="supporting">© {PROFILE.name}</Text>
        </LayoutFooter>
      }
    />
  );
}
