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
 * LocationMap - Minimalist location display
 *
 * Features:
 * - Static, print-style location indicator
 * - Optional link to Google Maps
 * - Grayscale aesthetic
 */
export default function LocationMap({
  city,
  state,
  country = "USA",
  coordinates,
}: LocationMapProps) {
  const fullLocation = [city, state, country].filter(Boolean).join(", ");

  // Generate Google Maps link if coordinates provided
  const mapsUrl = coordinates
    ? `https://www.google.com/maps?q=${coordinates.lat},${coordinates.lng}`
    : `https://www.google.com/maps/search/${encodeURIComponent(fullLocation)}`;

  return (
    <div className="border border-divider p-6">
      {/* Static Map Placeholder - Could be replaced with actual static map image */}
      <div className="aspect-video bg-ink/5 mb-4 relative overflow-hidden">
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center">
            <div className="w-3 h-3 bg-ink/40 mx-auto mb-2" />
            <span className="font-mono text-xs text-ink/40 uppercase tracking-wider">
              {city}
            </span>
          </div>
        </div>

        {/* Grid overlay for map aesthetic */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: `
              linear-gradient(to right, rgba(26, 26, 26, 0.05) 1px, transparent 1px),
              linear-gradient(to bottom, rgba(26, 26, 26, 0.05) 1px, transparent 1px)
            `,
            backgroundSize: "20px 20px",
          }}
        />
      </div>

      {/* Location Text & Link */}
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs uppercase tracking-wider text-ink/60">
          {fullLocation}
        </span>
        <a
          href={mapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-xs uppercase tracking-wider text-ink hover:text-ink/70 transition-colors"
        >
          View Map ↗
        </a>
      </div>
    </div>
  );
}
