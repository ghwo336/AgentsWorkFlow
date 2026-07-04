import { HomeClient } from "./_components/HomeClient";
import { orchJson } from "./lib/server/orch";
import type { ProjectSummary } from "./lib/types";

export const dynamic = "force-dynamic";

// Server component: the project list ships inside the HTML (orchestrator-local
// fetch) instead of the browser waterfalling HTML → JS → fetch.
export default async function ProjectsHomePage() {
  const projects = await orchJson<ProjectSummary[]>("/data/projects").catch(
    () => [] as ProjectSummary[]
  );
  return <HomeClient initialProjects={projects} />;
}
