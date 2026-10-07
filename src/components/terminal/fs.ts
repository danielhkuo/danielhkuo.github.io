// The site as a filesystem: the tree `ls`, `cd`, `cat` and `open` work on.
// Pure — no React, no DOM.

export interface FileNode {
  kind: "file";
  name: string;
  /** ISO 8601; what `ls -l` dates it by. */
  mtime: string;
  /** Bytes, as `ls -l` reports them. */
  size: number;
  /** Markdown source, for a file `cat` can read. */
  text?: string;
  /** What `open` launches. */
  url?: string;
}

export interface DirNode {
  kind: "dir";
  name: string;
  mtime: string;
  /** In name order. */
  children: FsNode[];
  url?: string;
}

export type FsNode = FileNode | DirNode;

/** A location as its components from the root: [] is "/". */
export type Path = readonly string[];

export const HOME: Path = ["Users", "daniel"];

export type Errno = "ENOENT" | "ENOTDIR";

/** The message for an errno, as libc words it. */
export function strerror(errno: Errno): string {
  return errno === "ENOENT" ? "No such file or directory" : "Not a directory";
}

/** What a path names — the node and where it is — or why it names nothing. */
export type Lookup = { node: FsNode; path: string[] } | { errno: Errno };

/** A directory. Entries sort by code unit, capitals first, as `ls` lists them on a Mac. */
export function dir(name: string, mtime: string, children: FsNode[], url?: string): DirNode {
  const sorted = [...children].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { kind: "dir", name, mtime, children: sorted, url };
}

/** A file: markdown `text` that `cat` reads, or just the `size` of something only `open` can show. */
export function file(
  name: string,
  mtime: string,
  body: { text?: string; size?: number; url?: string },
): FileNode {
  const size = body.size ?? new TextEncoder().encode(body.text ?? "").length;
  return { kind: "file", name, mtime, size, text: body.text, url: body.url };
}

/** A directory's entry by name. Any case matches, as on a Mac's case-insensitive volume. */
function child(parent: DirNode, name: string): FsNode | undefined {
  const lower = name.toLowerCase();
  return parent.children.find((c) => c.name.toLowerCase() === lower);
}

/**
 * Resolve `path` the way the kernel would: `~` is home, a leading `/` starts
 * at the root, anything else starts at `cwd`; `.` stays, `..` goes up (and
 * stops at the root), empty components are skipped. The path that comes back
 * is spelled as the tree spells it.
 */
export function lookup(root: DirNode, cwd: Path, path: string): Lookup {
  let rest = path;
  let start = cwd;
  if (rest === "~" || rest.startsWith("~/")) {
    start = HOME;
    rest = rest.slice(1);
  } else if (rest.startsWith("/")) {
    start = [];
  }

  // The nodes from the root down to where the walk is.
  const trail: FsNode[] = [root];
  for (const part of [...start, ...rest.split("/")]) {
    const here = trail[trail.length - 1];
    if (here.kind !== "dir") return { errno: "ENOTDIR" };
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (trail.length > 1) trail.pop();
      continue;
    }
    const next = child(here, part);
    if (!next) return { errno: "ENOENT" };
    trail.push(next);
  }
  return { node: trail[trail.length - 1], path: trail.slice(1).map((n) => n.name) };
}

/** "/Users/daniel/projects", as `pwd` prints it. */
export function absPath(path: Path): string {
  return "/" + path.join("/");
}

/** "~/projects": the path with home abbreviated, as zsh's `%~` shows it. */
export function tildePath(path: Path): string {
  if (!HOME.every((name, i) => path[i] === name)) return absPath(path);
  return ["~", ...path.slice(HOME.length)].join("/");
}

/**
 * What a half-typed path could complete to: the entries of its directory
 * part whose names start with the rest, spelled onto what was typed.
 * Directories end in "/" so the next completion carries on inside them.
 */
export function completions(root: DirNode, cwd: Path, typed: string, only?: "dir"): string[] {
  const cut = typed.lastIndexOf("/") + 1;
  const base = typed.slice(0, cut);
  const leaf = typed.slice(cut).toLowerCase();
  const found = lookup(root, cwd, base || ".");
  if ("errno" in found || found.node.kind !== "dir") return [];
  return found.node.children
    .filter((c) => (only !== "dir" || c.kind === "dir") && c.name.toLowerCase().startsWith(leaf))
    .map((c) => base + c.name + (c.kind === "dir" ? "/" : ""));
}
