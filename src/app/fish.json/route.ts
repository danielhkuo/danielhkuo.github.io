import { buildFish } from "@/lib/fish/build";
import type { FishSheet } from "@/lib/fish/types";
import { fetchPinnedRepos } from "@/lib/github";

// Rendered once at build time into a static /fish.json. The drawings are kept
// out of the page itself — six of them are ~110 KB — and fetched by the fish
// controller once a card is on screen, on devices that will show them.
export const dynamic = "force-static";

export async function GET() {
  const projects = await fetchPinnedRepos();
  const sheet: FishSheet = {};
  for (const project of projects) {
    try {
      sheet[project.name] = buildFish(project.name);
    } catch (error) {
      // A card with no drawing just stays a card; one bad fish must not sink the deploy.
      console.warn(`fish: could not draw "${project.name}"`, error);
    }
  }
  return Response.json(sheet);
}
