// The return key as the title draws it: the world's own pixel key cap (the one its guides show by the dragon), with ⏎
// drawn in the world's pixel font. The character stays in the text for screen readers and search, out of sight.

import PixelGlyph from "../../app/world/PixelGlyph";
import { keycap } from "../../world/controls/glyphs";

const UP = keycap("⏎");
const LIT = keycap("⏎", true);

export default function ReturnKey({
  className, px = 2, lit = false, decorative = false,
}: {
  className?: string;
  px?: number;
  lit?: boolean;
  /** On a control that already names itself ("Enter world"): hidden from screen readers. */
  decorative?: boolean;
}) {
  return (
    <kbd className={className} aria-hidden={decorative || undefined}>
      <PixelGlyph sprite={lit ? LIT : UP} px={px} />
      <span className="sr-only">⏎</span>
    </kbd>
  );
}
