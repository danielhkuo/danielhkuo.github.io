// The projects, one Markdown file each in `projects/` (projects/README.md gives the format), read at build time only.
// It reads files and calls GitHub, so client code imports its types only (`import type`). A file with a mistake fails
// the build with a message naming the file and the field: the owner edits these in the browser and reads the error in
// the GitHub Actions log.

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { graphql, GraphqlResponseError } from "@octokit/graphql";
import { parse, YAMLParseError } from "yaml";

const FIELDS = new Set(["name", "summary", "repo", "link", "image", "order"]);
const REPO = /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+$/;
const FENCE = /^---[ \t]*$/;

/** One project, read from its Markdown file. `slug` is the file's name and the stable key. */
export interface Project {
  /** File name without `.md`. */
  slug: string;
  name: string;
  /** One line. */
  summary: string;
  /** Markdown below the front matter. May be empty. */
  body: string;
  /** Lower comes first, and a tie goes by name. A file without one gets `Number.MAX_SAFE_INTEGER`, so it comes last. */
  order: number;
  /** `owner/name`, or null when the project names no repository. */
  repo: string | null;
  repoUrl: string | null;
  /** A live site or a write-up. */
  link: string | null;
  /** The image's path on the site, such as `/projects/leaf.png`, for a file in `public/projects/`. */
  image: string | null;
  /** Stars, forks and languages from GitHub at build time, or null. */
  github: {
    stars: number;
    forks: number;
    language: { name: string; color: string } | null;
    languages: { name: string; color: string; percentage: number }[];
    updatedAt: string;
  } | null;
}

type GitHubStats = NonNullable<Project["github"]>;

/**
 * Reads the projects folder and returns the projects, lowest order first.
 * With a GitHub token, each repository's stars, forks and languages are filled
 * in. A missing token or a failed request leaves `github` null and the build
 * continues.
 */
export async function loadProjects(options?: { dir?: string; token?: string }): Promise<Project[]> {
  const projects = readProjects(projectsDir(options?.dir));
  await fillGitHub(projects, tokenOf(options));
  return projects;
}

function tokenOf(options: { token?: string } | undefined): string | undefined {
  const given = options?.token;
  return given !== undefined ? given : process.env.GITHUB_TOKEN;
}

function projectsDir(dir: string | undefined): string {
  const chosen = dir ?? process.env.PROJECTS_DIR ?? "projects";
  const resolved = path.resolve(process.cwd(), chosen);
  let directory = false;
  try {
    directory = statSync(resolved).isDirectory();
  } catch {
    directory = false;
  }
  if (!directory) throw new Error(`No projects folder at ${relativeToCwd(resolved)}.`);
  return resolved;
}

function readProjects(dir: string): Project[] {
  const publicDir = path.join(path.dirname(dir), "public");
  const problems: string[] = [];
  const projects: Project[] = [];
  for (const name of markdownFiles(dir)) {
    const project = readProject(path.join(dir, name), publicDir, problems);
    if (project) projects.push(project);
  }
  if (problems.length > 0) fail(relativeToCwd(dir), problems);
  return sortProjects(projects);
}

function markdownFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.md$/i.test(entry.name) && !/^readme\.md$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function readProject(filePath: string, publicDir: string, problems: string[]): Project | undefined {
  const file = relativeToCwd(filePath);
  const opened = openFile(readFileSync(filePath, "utf8"));
  if (!opened.ok) {
    const at = opened.line === undefined ? file : `${file}, line ${opened.line}`;
    problems.push(`${at}: ${opened.problem}`);
    return;
  }

  const found = problems.length;
  const note = (text: string) => {
    problems.push(`${file}: ${text}`);
  };
  for (const key of Object.keys(opened.fields)) {
    if (!FIELDS.has(key)) {
      note(
        `unknown field "${key}". A project's fields are name, summary, repo, link, image and order; its description goes below the front matter.`,
      );
    }
  }
  const name = textField("name", opened.fields.name, note);
  const summary = textField("summary", opened.fields.summary, note);
  const repo = repoField(opened.fields.repo, note);
  const link = linkField(opened.fields.link, note);
  const image = imageField(opened.fields.image, publicDir, note);
  const order = orderField(opened.fields.order, note);
  if (
    name === undefined ||
    summary === undefined ||
    repo === undefined ||
    link === undefined ||
    image === undefined ||
    order === undefined ||
    problems.length > found
  ) {
    return;
  }

  return {
    slug: path.basename(filePath).replace(/\.md$/i, ""),
    name,
    summary,
    body: opened.body,
    order,
    repo,
    repoUrl: repo === null ? null : `https://github.com/${repo}`,
    link,
    image,
    github: null,
  };
}

interface Opened {
  ok: true;
  fields: Record<string, unknown>;
  body: string;
}

interface Unopened {
  ok: false;
  problem: string;
  line?: number;
}

function openFile(raw: string): Opened | Unopened {
  const lines = raw.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").split("\n");
  if (!FENCE.test(lines[0] ?? "")) {
    return {
      ok: false,
      problem:
        "the file must start with front matter: a line of three dashes (---), the fields, then another line of three dashes.",
    };
  }
  const close = lines.findIndex((line, index) => index > 0 && FENCE.test(line));
  if (close < 0) {
    return {
      ok: false,
      problem: "the front matter is never closed: put a line of three dashes (---) after the last field.",
    };
  }

  const body = lines.slice(close + 1).join("\n").trim();
  let value: unknown;
  try {
    value = parse(lines.slice(1, close).join("\n"));
  } catch (error) {
    if (!(error instanceof YAMLParseError)) throw error;
    const line = (error.linePos?.[0]?.line ?? 1) + 1;
    const reason = error.message.split(" at line ")[0];
    return {
      ok: false,
      line,
      problem: `the front matter is not valid YAML (${reason}). A value with a colon in it, or that starts with a quote or a symbol, needs quotes around it.`,
    };
  }
  if (value === null || value === undefined) return { ok: true, fields: {}, body };
  if (!isPlainObject(value)) {
    return { ok: false, problem: "the front matter must be fields, one to a line, like name: My project." };
  }
  return { ok: true, fields: value, body };
}

function textField(field: "name" | "summary", value: unknown, note: (text: string) => void): string | undefined {
  if (isBlank(value)) {
    note(`"${field}" is missing. Every project needs a name and a summary.`);
    return;
  }
  if (typeof value !== "string") {
    const quote =
      typeof value === "number" || typeof value === "boolean" ? ` Put it in quotes: ${field}: "${String(value)}".` : "";
    note(`"${field}" must be text, but it is ${describe(value)}.${quote}`);
    return;
  }
  return value.replace(/\s+/g, " ").trim();
}

function repoField(value: unknown, note: (text: string) => void): string | null | undefined {
  if (isBlank(value)) return null;
  if (typeof value === "string" && REPO.test(value.trim())) return value.trim();
  note(`"repo" must be a GitHub repository written owner/name, like danielhkuo/leaf, but it is ${shown(value)}.`);
  return;
}

function linkField(value: unknown, note: (text: string) => void): string | null | undefined {
  if (isBlank(value)) return null;
  if (typeof value === "string") {
    const link = value.trim();
    try {
      const url = new URL(link);
      if (url.protocol === "http:" || url.protocol === "https:") return link;
    } catch {
      // Not a web address; the message below says so.
    }
  }
  note(`"link" must be a whole web address, starting https://, but it is ${shown(value)}.`);
  return;
}

function imageField(
  value: unknown,
  publicDir: string,
  note: (text: string) => void,
): string | null | undefined {
  if (isBlank(value)) return null;
  if (typeof value !== "string" || !isProjectImage(value.trim())) {
    note(
      `"image" must be a file in public/projects/, written /projects/<its name>, like /projects/leaf.png, but it is ${shown(value)}.`,
    );
    return;
  }
  const image = value.trim();
  let file = false;
  try {
    file = statSync(path.join(publicDir, image)).isFile();
  } catch {
    file = false;
  }
  if (!file) note(`"image" is ${image}, but there is no file at public${image}.`);
  return file ? image : undefined;
}

function isProjectImage(image: string): boolean {
  return image.startsWith("/projects/") && path.posix.normalize(image).startsWith("/projects/");
}

function orderField(value: unknown, note: (text: string) => void): number | undefined {
  if (isBlank(value)) return Number.MAX_SAFE_INTEGER;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  note(`"order" must be a number, like order: 3, but it is ${describe(value)}.`);
  return;
}

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === "string" && value.trim() === "");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype;
}

function describe(value: unknown): string {
  if (typeof value === "string") return `the text ${JSON.stringify(value)}`;
  if (typeof value === "number") return `the number ${value}`;
  if (typeof value === "boolean") return `the value ${value}`;
  if (Array.isArray(value)) return "a list";
  return "a set of fields";
}

function shown(value: unknown): string {
  return typeof value === "string" ? JSON.stringify(value) : describe(value);
}

function fail(dir: string, problems: string[]): never {
  const noun = problems.length === 1 ? "problem" : "problems";
  const lines = problems.map((problem) => `  ${problem}`).join("\n");
  throw new Error(
    `${problems.length} ${noun} in the project files:\n${lines}\nEach project is a Markdown file in ${dir}/, and ${dir}/README.md shows the format.`,
  );
}

function sortProjects(projects: Project[]): Project[] {
  const names = new Intl.Collator("en", { numeric: true });
  projects.sort((a, b) => {
    if (a.order !== b.order) return a.order < b.order ? -1 : 1;
    const byName = names.compare(a.name, b.name);
    if (byName !== 0) return byName;
    if (a.slug < b.slug) return -1;
    if (a.slug > b.slug) return 1;
    return 0;
  });
  return projects;
}

function relativeToCwd(target: string): string {
  return path.relative(process.cwd(), target).split(path.sep).join("/");
}

interface GitHubRepository {
  stargazerCount: number;
  forkCount: number;
  updatedAt: string;
  primaryLanguage: { name: string; color: string | null } | null;
  languages: {
    totalSize: number;
    edges: { size: number; node: { name: string; color: string | null } }[];
  };
}

async function fillGitHub(projects: Project[], token: string | undefined): Promise<void> {
  const repos = distinctRepos(projects);
  if (repos.length === 0) return;
  if (!token) {
    console.warn("projects: no GITHUB_TOKEN, so the projects are built without GitHub's stars, forks and languages.");
    return;
  }
  try {
    const data = await requestStats(repos, token);
    const missing = assignStats(projects, repos, data);
    if (missing.length === 0) return;
    const one = missing.length === 1;
    console.warn(
      `projects: GitHub gave no stats for ${missing.join(", ")}, so ${one ? "that project is" : "those projects are"} built without them.`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`projects: could not fetch GitHub's stats (${message}), so the projects are built without them.`);
  }
}

function distinctRepos(projects: Project[]): string[] {
  const repos: string[] = [];
  const seen = new Set<string>();
  for (const project of projects) {
    if (project.repo === null || seen.has(project.repo)) continue;
    seen.add(project.repo);
    repos.push(project.repo);
  }
  return repos;
}

async function requestStats(repos: string[], token: string): Promise<Record<string, GitHubRepository | null>> {
  const { query, variables } = statsQuery(repos);
  try {
    return await graphql<Record<string, GitHubRepository | null>>(query, {
      ...variables,
      headers: { authorization: `token ${token}` },
    });
  } catch (error) {
    // A repository GitHub cannot find still comes back, as null, beside the ones it found.
    if (error instanceof GraphqlResponseError && isStatsMap(error.data)) return error.data;
    throw error;
  }
}

function isStatsMap(value: unknown): value is Record<string, GitHubRepository | null> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function statsQuery(repos: string[]): { query: string; variables: Record<string, string> } {
  const declarations: string[] = [];
  const fields: string[] = [];
  const variables: Record<string, string> = {};
  repos.forEach((repo, index) => {
    const slash = repo.indexOf("/");
    variables[`o${index}`] = repo.slice(0, slash);
    variables[`n${index}`] = repo.slice(slash + 1);
    declarations.push(`$o${index}: String!`, `$n${index}: String!`);
    fields.push(`  r${index}: repository(owner: $o${index}, name: $n${index}) { ...stats }`);
  });
  const query = [
    `query(${declarations.join(", ")}) {`,
    ...fields,
    "}",
    "fragment stats on Repository {",
    "  stargazerCount",
    "  forkCount",
    "  updatedAt",
    "  primaryLanguage { name color }",
    "  languages(first: 10, orderBy: { field: SIZE, direction: DESC }) { totalSize edges { size node { name color } } }",
    "}",
  ].join("\n");
  return { query, variables };
}

function assignStats(projects: Project[], repos: string[], data: Record<string, GitHubRepository | null>): string[] {
  const stats = new Map<string, GitHubStats>();
  const missing: string[] = [];
  repos.forEach((repo, index) => {
    const node = data[`r${index}`];
    if (!node) {
      missing.push(repo);
      return;
    }
    stats.set(repo, toGithub(node));
  });
  for (const project of projects) {
    if (project.repo) project.github = stats.get(project.repo) ?? null;
  }
  return missing;
}

function toGithub(repo: GitHubRepository): GitHubStats {
  const totalSize = repo.languages.totalSize;
  const primary = repo.primaryLanguage;
  return {
    stars: repo.stargazerCount,
    forks: repo.forkCount,
    language: primary ? { name: primary.name, color: primary.color ?? "#858585" } : null,
    languages: repo.languages.edges.map((edge) => ({
      name: edge.node.name,
      color: edge.node.color ?? "#858585",
      percentage: totalSize > 0 ? (edge.size / totalSize) * 100 : 0,
    })),
    updatedAt: repo.updatedAt,
  };
}
