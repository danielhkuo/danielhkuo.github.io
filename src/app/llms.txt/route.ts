import { llmsTxt } from "@/lib/agent-docs";
import { loadPinnedRepos } from "@/lib/github";
import { publishedProjects } from "@/lib/site-content";

// Written once at build time: the static export saves the response as out/llms.txt.
export const dynamic = "force-static";

export async function GET() {
  const projects = publishedProjects(await loadPinnedRepos());
  return new Response(llmsTxt(projects), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
