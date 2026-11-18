// The watercolour cloud style. Until its painter is built, it paints plain clouds.

import type { Painter } from "../sprite.ts";
import { paintPlain } from "./plain.ts";

export const paintWatercolour: Painter = paintPlain;
