// The minimal version's type size, as minimal.css sets it, kept here for the grow: the window's text comes to this size
// as the window fills the screen, so the cut to /minimal changes no size. A test holds these to minimal.css.

/** On phones and anything with a coarse pointer: no zoom when the search field takes focus. */
export const NANO_TEXT_PX = 16;

/** A desktop with a mouse gets the mock's size. */
export const NANO_TEXT_FINE_PX = 15;

/** Where the finer size applies, exactly as minimal.css writes its media query. */
export const NANO_FINE_QUERY = "(min-width: 640px) and (hover: hover) and (pointer: fine)";

/** The size /minimal will set its text at on this screen. */
export function nanoTextPx(matches: (query: string) => boolean): number {
  return matches(NANO_FINE_QUERY) ? NANO_TEXT_FINE_PX : NANO_TEXT_PX;
}
