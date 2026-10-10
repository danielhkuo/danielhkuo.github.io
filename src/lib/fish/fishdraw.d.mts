// Types for the vendored generator. Only what the site imports is declared.

export type Point = [number, number];
export type Polyline = Point[];

/** The 49 anatomy parameters; opaque to the site, which only passes them on. */
export type FishParams = Record<string, number | boolean>;

/** Strokes by part: body and skin, the six fins, head, then three hatching passes. */
export type FishPartName = "bd" | "f0" | "f1" | "f2" | "f3" | "f4" | "f5" | "fh" | "sh" | "sh2" | "sh3";

/**
 * Closed polygons the strokes were clipped against. `c0`–`c5` are the fins
 * (`c5`, the finlet, is absent on fish without one) and `cf` is the region the
 * head cuts out of the body.
 */
export type FishPolyName = "body" | "c0" | "c1" | "c2" | "c3" | "c4" | "c5" | "cf" | "head" | "lip0" | "lip1" | "jaw";

/** Seed the generator from a string and reset its noise table. */
export function reseed(seed: string): void;

/** Draw the anatomy parameters from the seeded generator. */
export function generate_params(): FishParams;

/** Draw one fish. `parts` and `polys` describe the fish from the latest call. */
export const fish: {
  (params: FishParams): Polyline[];
  parts: Record<FishPartName, Polyline[]>;
  polys: Partial<Record<FishPolyName, Polyline>>;
};

/** Douglas–Peucker simplification; returns a new polyline. */
export function approx_poly_dp(polyline: Polyline, epsilon: number): Polyline;
