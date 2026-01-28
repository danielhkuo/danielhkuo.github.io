import Image from "next/image";

export default function Masthead() {
  return (
    <header className="border-b border-divider">
      <div className="max-w-7xl mx-auto px-8 py-16">
        <div className="grid grid-cols-1 md:grid-cols-[300px_1fr] gap-12">
          {/* Left Column - Portrait Photo */}
          <div className="relative aspect-[3/4] bg-ink/10 overflow-hidden">
            <Image
              src="/headshot.webp"
              alt="Daniel Kuo"
              fill
              className="object-cover"
              style={{
                filter: "grayscale(100%) contrast(1.1)",
              }}
              priority
            />
            {/* Film grain texture overlay */}
            <div
              className="absolute inset-0 pointer-events-none opacity-20 mix-blend-overlay"
              style={{
                backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 400 400' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`,
              }}
            />
          </div>

          {/* Right Column - Identity & Status */}
          <div className="flex flex-col justify-center gap-6">
            {/* Name - Large Serif */}
            <h1 className="font-serif text-6xl font-light tracking-tight text-ink">
              Daniel Kuo
            </h1>

            {/* Role - Monospace Subtitle */}
            <p className="font-mono text-sm uppercase tracking-wider text-ink/70">
              Software Engineer
            </p>

            {/* Status Indicator */}
            <div className="flex items-center gap-3">
              <div className="w-2 h-2 bg-available rounded-full animate-pulse" />
              <span className="font-mono text-xs uppercase tracking-wider text-ink/70">
                Available for work
              </span>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
