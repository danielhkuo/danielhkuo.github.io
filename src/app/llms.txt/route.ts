import { llmsTxt } from "@/lib/agent-docs";
import { loadProjects } from "@/lib/projects";

// Written once at build time: the static export saves the response as out/llms.txt.
export const dynamic = "force-static";

export async function GET() {
  return new Response(llmsTxt(await loadProjects()), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
