import { agentsMd } from "@/lib/agent-docs";
import { loadProjects } from "@/lib/projects";

// Written once at build time: the static export saves the response as out/agents.md.
export const dynamic = "force-static";

export async function GET() {
  return new Response(agentsMd(await loadProjects()), {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}
