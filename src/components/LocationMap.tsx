"use client";

interface LocationMapProps {
  city: string;
  state?: string;
  country?: string;
  coordinates?: {
    lat: number;
    lng: number;
  };
}

/**
 * LocationMap - Interactive embedded map with editorial styling
 *
 * Features:
 * - OpenStreetMap embedded iframe with grayscale filter
 * - Fallback to static representation
 * - Link to Google Maps for directions
 */
export default function LocationMap({
  city,
  state,
  country = "USA",
  coordinates,
}: LocationMapProps) {
  const fullLocation = [city, state, country].filter(Boolean).join(", ");

  // Generate map URLs
  const mapsUrl = coordinates
    ? `https://www.google.com/maps?q=${coordinates.lat},${coordinates.lng}`
    : `https://www.google.com/maps/search/${encodeURIComponent(fullLocation)}`;

  // OpenStreetMap embed URL (grayscale tiles)
  const osmEmbedUrl = coordinates
    ? `https://www.openstreetmap.org/export/embed.html?bbox=${coordinates.lng - 0.05},${coordinates.lat - 0.05},${coordinates.lng + 0.05},${coordinates.lat + 0.05}&layer=mapnik&marker=${coordinates.lat},${coordinates.lng}`
    : null;

  return (
    <div className="overflow-hidden">
      <div className="relative min-h-[360px] bg-bg lg:min-h-[520px]">
        {osmEmbedUrl ? (
          <iframe
            src={osmEmbedUrl}
            className="absolute inset-0 h-full w-full"
            loading="lazy"
            style={{
              filter: "grayscale(100%) contrast(1.1) sepia(22%) saturate(0.85)",
              border: 0,
            }}
            title={`Map of ${fullLocation}`}
            sandbox="allow-scripts"
          />
        ) : (
          // Fallback to static representation
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <div className="mx-auto mb-2 size-3 rounded-full bg-primary/40" />
              <span className="caps-label text-xs text-text-primary">
                {city}
              </span>
            </div>
          </div>
        )}

        {/* Printed-map registration grid. */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: `
              linear-gradient(to right, color-mix(in srgb, var(--accent) 7%, transparent) 1px, transparent 1px),
              linear-gradient(to bottom, color-mix(in srgb, var(--accent) 7%, transparent) 1px, transparent 1px)
            `,
            backgroundSize: "28px 28px",
          }}
        />

        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_48%_46%,transparent_0,transparent_28%,color-mix(in_srgb,var(--bg)_56%,transparent)_100%)]" />

        <div className="absolute left-5 top-5 rounded-[1rem] border border-divider bg-surface/95 px-4 py-3 shadow-sm">
          <p className="caps-label text-[0.68rem] text-accent">Map</p>
          <p className="mt-1 font-display text-lg font-medium leading-tight text-text-primary">
            Houston, Texas
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-divider bg-surface p-4 sm:p-5">
        <span className="capsule-shell inline-flex w-fit items-center px-4 py-2 caps-label text-xs text-text-muted">
          {coordinates ? `${coordinates.lat.toFixed(4)} · ${coordinates.lng.toFixed(4)}` : city}
        </span>
        <a
          href={mapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="capsule-shell inline-flex w-fit items-center px-4 py-2 caps-label text-xs text-text-primary hover:border-primary hover:shadow-md"
        >
          View Map ↗
        </a>
      </div>
    </div>
  );
}
