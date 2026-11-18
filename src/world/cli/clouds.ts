// The cloud contact sheet: the shipped world drawn with each cloud style, side by side.
//
//   npm run world:clouds [-- --t <seconds>]
//
// Writes .cache/world-clouds/sheet.png (styles as columns, views as rows) and each frame on its own.

/** Parses argv, renders the sheet and the frames, prints where they are; 0 on success. */
export async function main(argv: readonly string[]): Promise<number> {
  void argv;
  throw new Error("not implemented");
}
