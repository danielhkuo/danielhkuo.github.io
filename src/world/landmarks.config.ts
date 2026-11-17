// Which landmark each pinned project stands as. The owner edits this; a
// project not listed gets a type from a hash of its repository name.
import type { LandmarkType } from "./sites/assign.ts";

export const LANDMARK_CONFIG: Readonly<Record<string, LandmarkType>> = {};
