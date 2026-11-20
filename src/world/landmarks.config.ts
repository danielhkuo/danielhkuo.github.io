// Which landmark each project stands as, keyed by project slug. The owner edits this; a
// project not listed gets a type from a hash of its slug.
import type { LandmarkType } from "./sites/assign.ts";

export const LANDMARK_CONFIG: Readonly<Record<string, LandmarkType>> = {};
