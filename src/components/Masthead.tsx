import Image from "next/image";

export default function Masthead() {
  return (
    <header className="px-5 pt-28 sm:px-8 lg:px-10">
      <div className="mx-auto max-w-6xl">
        <div className="paper-panel overflow-hidden rounded-[2.25rem] p-3 sm:p-4">
          <div className="grid gap-4 rounded-[1.75rem] bg-bg/70 p-4 sm:p-5 lg:grid-cols-[0.78fr_1.22fr] lg:items-stretch lg:p-6">
            <div className="relative min-h-[420px] overflow-hidden rounded-[1.5rem] border border-divider bg-surface sm:min-h-[520px] lg:min-h-[540px]">
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
            </div>

            <div className="flex min-h-[420px] flex-col justify-between rounded-[1.5rem] border border-divider bg-surface p-6 sm:min-h-[520px] sm:p-8 lg:min-h-[540px] lg:p-10">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="kami-tag px-3 py-2">Rice CS</span>
                  <span className="kami-tag px-3 py-2">Houston</span>
                  <span className="kami-tag px-3 py-2">Goldman Sachs AWM</span>
                </div>

                <div className="mt-10 max-w-2xl">
                  <p className="caps-label text-xs text-accent">Daniel Kuo</p>
                  <h1 className="mt-4 font-display text-5xl font-medium leading-[0.98] tracking-[var(--tracking-display)] text-text-primary sm:text-6xl lg:text-7xl">
                    Software engineer.
                  </h1>
                  <p className="mt-6 max-w-xl text-lg leading-[1.45] text-text-muted">
                    I build clean product surfaces, practical AI tools, and reliable systems.
                  </p>
                </div>
              </div>

              <div className="mt-10 grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-center">
                <p className="text-sm leading-[1.45] text-text-secondary">
                  AI products · self-hosted infrastructure · finance tooling
                </p>
                <a
                  href="/Daniel-Kuo-Resume.pdf"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="capsule-shell inline-flex min-h-11 items-center justify-center px-5 py-3 font-caps text-xs tracking-[var(--tracking-label)] text-text-primary hover:border-primary hover:shadow-md"
                >
                  Resume
                </a>
                <a
                  href="mailto:danielhkuo@rice.edu"
                  className="inline-flex min-h-11 items-center justify-center rounded-full bg-primary px-5 py-3 font-caps text-xs tracking-[var(--tracking-label)] text-[var(--accent-on)] shadow-[var(--elev-ring-accent)] hover:shadow-md"
                >
                  Email
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
