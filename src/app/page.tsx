import Masthead from "@/components/Masthead";

export default function Home() {
  return (
    <div className="min-h-screen bg-paper">
      {/* The Masthead */}
      <Masthead />

      {/* Main Content Area - Single Column Vertical Stack */}
      <main className="max-w-7xl mx-auto px-8 py-16">

        {/* The Bio Block */}
        <section className="max-w-3xl mb-24">
          <h2 className="font-serif text-3xl font-light mb-6 text-ink">
            About
          </h2>
          <div className="border-t border-divider pt-6">
            <p className="text-lg leading-relaxed text-ink/80 mb-4">
              A brief narrative introduction about yourself. This section should be
              personal yet professional, giving visitors a sense of who you are and
              what drives your work.
            </p>
            <p className="text-lg leading-relaxed text-ink/80">
              The typography is generous, mimicking book layout. The structure is
              journalistic—facts first, personality second.
            </p>
          </div>
        </section>

        {/* The Stack Block */}
        <section className="mb-24">
          <h2 className="font-serif text-3xl font-light mb-6 text-ink">
            Tools & Technologies
          </h2>
          <div className="border-t border-divider pt-8">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
              {["React", "TypeScript", "Next.js", "Tailwind", "Node.js", "Git", "Figma", "Python"].map((tool) => (
                <div
                  key={tool}
                  className="border border-divider p-6 hover:border-ink/20 transition-colors"
                >
                  <span className="font-mono text-sm text-ink/70">
                    {tool}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* The Project Feed - Placeholder */}
        <section>
          <h2 className="font-serif text-3xl font-light mb-6 text-ink">
            Selected Work
          </h2>
          <div className="border-t border-divider pt-8">
            <p className="font-mono text-sm text-ink/50">
              Projects will be automatically populated from GitHub pinned repositories...
            </p>
          </div>
        </section>

      </main>

      {/* Footer */}
      <footer className="border-t border-divider mt-32">
        <div className="max-w-7xl mx-auto px-8 py-12">
          <p className="font-mono text-xs text-ink/40 uppercase tracking-wider">
            © {new Date().getFullYear()} — Digital Print Portfolio
          </p>
        </div>
      </footer>
    </div>
  );
}
