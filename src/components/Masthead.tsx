export default function Masthead() {
  return (
    <header className="border-b border-divider">
      <div className="max-w-7xl mx-auto px-8 py-16">
        <div className="grid grid-cols-1 md:grid-cols-[300px_1fr] gap-12">
          {/* Left Column - Portrait Photo */}
          <div className="relative aspect-[3/4] bg-ink/10">
            {/* Placeholder for profile photo */}
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="font-mono text-sm text-ink/40">
                PORTRAIT
              </span>
            </div>
            {/* Future: Add grayscale image with film grain filter */}
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
