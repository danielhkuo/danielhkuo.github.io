import Image from "next/image";
import { Card, Grid, VStack, HStack, StackItem, Badge, Heading, Text, Button } from "@astryxdesign/core";

export default function Masthead() {
  return (
    <header className="px-5 pt-28 sm:px-8 lg:px-10">
      <VStack gap={0} className="mx-auto max-w-6xl">
        <Card padding={2} className="overflow-hidden rounded-[2.25rem]">
          <Grid columns={{ minWidth: 320, max: 2 }} gap={4} className="items-stretch">
            <Card
              padding={0}
              className="relative min-h-[420px] overflow-hidden rounded-[1.5rem] sm:min-h-[520px] lg:min-h-[540px]"
            >
              <Image
                src="/headshot.webp"
                alt="Daniel Kuo"
                fill
                sizes="(max-width: 1024px) 100vw, 420px"
                className="object-cover object-center"
                style={{ filter: "grayscale(100%) contrast(1.03) sepia(12%)" }}
                priority
              />
              <div className="absolute inset-0 bg-[linear-gradient(to_bottom,transparent_55%,rgba(20,20,19,0.18)_100%)]" />
            </Card>

            <Card
              padding={6}
              className="min-h-[420px] rounded-[1.5rem] sm:min-h-[520px] sm:p-8 lg:min-h-[540px] lg:p-10"
            >
              <VStack gap={0} vAlign="between" height="100%">
                <VStack gap={0}>
                  <HStack gap={2} wrap="wrap">
                    <Badge label="Rice CS" variant="neutral" />
                    <Badge label="Houston" variant="neutral" />
                    <Badge label="Goldman Sachs AWM" variant="neutral" />
                  </HStack>

                  <VStack gap={0} className="mt-10 max-w-2xl">
                    <Text type="label" as="p" color="accent" className="caps-label text-xs">
                      Daniel Kuo
                    </Text>
                    <Heading
                      level={1}
                      type="display-1"
                      className="mt-4 font-display text-[clamp(38px,5vw,60px)] font-medium leading-[0.98] tracking-[-1.5px] text-text-primary"
                    >
                      Full-stack product builder &amp; team architect.
                    </Heading>
                    <Text type="large" as="p" color="secondary" className="mt-6 max-w-xl leading-[1.45]">
                      I build clean product surfaces, practical AI tools, and reliable systems.
                    </Text>
                  </VStack>
                </VStack>

                <HStack gap={3} wrap="wrap" vAlign="center" className="mt-10">
                  <StackItem size="fill">
                    <Text type="body" as="p" color="secondary" className="text-sm leading-[1.45]">
                      AI products · self-hosted infrastructure · finance tooling
                    </Text>
                  </StackItem>
                  <Button
                    label="Resume"
                    variant="secondary"
                    href="/Daniel-Kuo-Resume.pdf"
                    target="_blank"
                    rel="noopener noreferrer"
                  />
                  <Button
                    label="Email"
                    variant="primary"
                    href="mailto:danielhkuo@rice.edu"
                  />
                </HStack>
              </VStack>
            </Card>
          </Grid>
        </Card>
      </VStack>
    </header>
  );
}
