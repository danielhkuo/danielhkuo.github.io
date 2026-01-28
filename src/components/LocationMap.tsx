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
    <div className="border border-divider overflow-hidden">
      {/* Embedded Map */}
      <div className="aspect-video bg-ink/5 relative overflow-hidden">
        {osmEmbedUrl ? (
          <iframe
            src={osmEmbedUrl}
            className="w-full h-full"
            style={{
              filter: "grayscale(100%) contrast(1.1) invert(100%)",
              border: 0,
            }}
            title={`Map of ${fullLocation}`}
          />
        ) : (
          // Fallback to static representation
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <div className="w-3 h-3 bg-ink/40 mx-auto mb-2" />
              <span className="font-mono text-xs text-ink/40 uppercase tracking-wider">
                {city}
              </span>
            </div>
          </div>
        )}

        {/* Grid overlay for map aesthetic */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: `
              linear-gradient(to right, rgba(26, 26, 26, 0.03) 1px, transparent 1px),
              linear-gradient(to bottom, rgba(26, 26, 26, 0.03) 1px, transparent 1px)
            `,
            backgroundSize: "20px 20px",
          }}
        />
      </div>

      {/* Location Text & Link */}
      <div className="flex items-center justify-between p-4 bg-paper">
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
