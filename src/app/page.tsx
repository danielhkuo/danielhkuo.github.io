import Masthead from "@/components/Masthead";
import ProjectCard from "@/components/ProjectCard";
import LiveTime from "@/components/LiveTime";
import LocationMap from "@/components/LocationMap";
import { CopyableText } from "@/components/CopyButton";
import ContactForm from "@/components/ContactForm";
import { fetchPinnedRepos } from "@/lib/github";

export default async function Home() {
  // Fetch pinned repos at build time (SSG)
  const projects = await fetchPinnedRepos();
  return (
    <div className="min-h-screen bg-paper">
      {/* The Masthead */}
      <Masthead />

      {/* Main Content Area - Single Column Vertical Stack */}
      <main className="max-w-5xl mx-auto px-8 py-16">

        {/* The Bio Block */}
        <section className="mb-24">
          <h2 className="font-serif text-3xl font-light mb-6 text-ink">
            About
          </h2>
          <div className="border-t border-divider pt-6">
            <div className="max-w-4xl">
              <p className="text-lg leading-relaxed text-ink/80 mb-4">
Hi! I&apos;m Daniel.
              </p>
              <p className="text-lg leading-relaxed text-ink/80 mb-4">
My background lies primarily in software development and secondarily in business. I have extensive hands-on experience managing (and breaking) a homelab environment (Unraid), running startups, and teaching, guiding, and assisting software projects as a PM and dev. Current personal projects focus on building AI-powered mobile applications, self-hosted services, movie selection websites, and much more.
              </p>
              <p className="text-lg leading-relaxed text-ink/80">
On a more serious note, I care deeply about building impactful products while leveraging technology in an ethical manner. I firmly support open source initiatives and awareness around the future of AI. Outside of tech, I enjoy reading, playing the cello, basketball, building mechanical keyboards, and following the competitive Apex Legends eSports scene. Currently thinking of picking up cycling again. (hit me up if u have bike recs!)
              </p>
            </div>
          </div>
        </section>

        {/* The Stack Block */}
        <section className="mb-24">
          <h2 className="font-serif text-3xl font-light mb-6 text-ink">
            Tools & Technologies
          </h2>
          <div className="border-t border-divider pt-8">
            {/* Languages */}
            <div className="mb-8">
              <h3 className="font-mono text-xs uppercase tracking-wider text-ink/50 mb-4">
                Languages
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {["Java", "Python", "Go", "TypeScript", "JavaScript", "C", "C++"].map((tool) => (
                  <div
                    key={tool}
                    className="border border-divider p-4 hover:border-ink/20 transition-colors"
                  >
                    <span className="font-mono text-sm text-ink/70">
                      {tool}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Frameworks & Libraries */}
            <div className="mb-8">
              <h3 className="font-mono text-xs uppercase tracking-wider text-ink/50 mb-4">
                Frameworks & Libraries
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {["React", "React Native", "Node.js", "Next.js", "LangChain"].map((tool) => (
                  <div
                    key={tool}
                    className="border border-divider p-4 hover:border-ink/20 transition-colors"
                  >
                    <span className="font-mono text-sm text-ink/70">
                      {tool}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Cloud & DevOps */}
            <div className="mb-8">
              <h3 className="font-mono text-xs uppercase tracking-wider text-ink/50 mb-4">
                Cloud & Developer Tools
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {["AWS", "Azure", "Docker", "Git", "NGINX", "Postman", "Cloudflare", "Linux"].map((tool) => (
                  <div
                    key={tool}
                    className="border border-divider p-4 hover:border-ink/20 transition-colors"
                  >
                    <span className="font-mono text-sm text-ink/70">
                      {tool}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Databases */}
            <div>
              <h3 className="font-mono text-xs uppercase tracking-wider text-ink/50 mb-4">
                Databases
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {["PostgreSQL", "MongoDB"].map((tool) => (
                  <div
                    key={tool}
                    className="border border-divider p-4 hover:border-ink/20 transition-colors"
                  >
                    <span className="font-mono text-sm text-ink/70">
                      {tool}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Interactive Micro-Islands */}
        <section className="mb-24">
          <h2 className="font-serif text-3xl font-light mb-6 text-ink">
            Currently
          </h2>
          <div className="border-t border-divider pt-8">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
              {/* Live Time Widget */}
              <div>
                <h3 className="font-mono text-xs uppercase tracking-wider text-ink/50 mb-4">
                  Local Time
                </h3>
                <LiveTime
                  timezone="America/Chicago"
                  location="Houston, TX"
                />
              </div>

              {/* Contact Info */}
              <div>
                <h3 className="font-mono text-xs uppercase tracking-wider text-ink/50 mb-4">
                  Get in Touch
                </h3>
                <CopyableText
                  text="danielhkuo@rice.edu"
                  displayText="danielhkuo@rice.edu"
                />
              </div>
            </div>

            {/* Location Map */}
            <LocationMap
              city="Houston"
              state="Texas"
              country="USA"
              coordinates={{ lat: 29.7168, lng: -95.4036 }}
            />
          </div>
        </section>

        {/* The Project Feed */}
        <section>
          <h2 className="font-serif text-3xl font-light mb-6 text-ink">
            Selected Work
          </h2>
          <div className="border-t border-divider pt-12">
            {projects.length > 0 ? (
              projects.map((project) => (
                <ProjectCard key={project.name} project={project} />
              ))
            ) : (
              <p className="font-mono text-sm text-ink/50">
                No pinned repositories found. Add a GITHUB_TOKEN to fetch real projects.
              </p>
            )}
          </div>
        </section>

        {/* Contact Section */}
        <section className="mt-32">
          <h2 className="font-serif text-3xl font-light mb-6 text-ink">
            Get in Touch
          </h2>
          <div className="border-t border-divider pt-8">
            <ContactForm formspreeId="your_formspree_id" />
          </div>
        </section>

      </main>

      {/* Footer */}
      <footer className="border-t border-divider mt-32">
        <div className="max-w-5xl mx-auto px-8 py-12">
          <p className="font-mono text-xs text-ink/40 uppercase tracking-wider">
            © {new Date().getFullYear()} — Digital Print Portfolio
          </p>
        </div>
      </footer>
    </div>
  );
}
