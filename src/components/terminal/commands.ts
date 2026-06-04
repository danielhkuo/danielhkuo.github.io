// Command registry. Pure logic — handlers emit data through `ctx`, never JSX.
// `buildCommands` closes over the page bridge (`api`) and the nav-path getter/
// setter so `cd` can move a simulated cwd without rebuilding the registry.

import { CONTACT_ROWS, LINKS, SECTIONS, WHOAMI_LINES } from "./content";
import type {
  CommandMap,
  TerminalApi,
  ThemeMode,
  TerminalLine,
} from "./types";

/** Slugify a repo name into a stable command key (matches the reference). */
export function projectKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/** Lines shown when the terminal first opens (and never auto-cleared). */
export function welcomeLines(): TerminalLine[] {
  return [
    { kind: "out", text: "`daniel_kuo` :: interactive shell" },
    {
      kind: "out",
      text: "`ls` to look around · `cd` to navigate · `help` for commands · `tab` completes",
    },
  ];
}

export function buildCommands(
  api: TerminalApi,
  getNavPath: () => string[],
  setNavPath: (p: string[]) => void,
): CommandMap {
  const sectionByDir = new Map(SECTIONS.map((s) => [s.dir, s] as const));

  const cmds: CommandMap = {
    help: {
      desc: "list commands",
      run: (_args, ctx) => {
        ctx.out(
          "hit `tab` to autocomplete · `cd` to move around · `theme dark` to flip the lights",
        );
        const groups: { name: string; names: string[] }[] = [
          { name: "navigation", names: ["cd", "ls", "pwd"] },
          { name: "info", names: ["whoami", "contact", "resume", "projects"] },
          { name: "open", names: ["open", "github", "linkedin", "email"] },
          { name: "settings", names: ["theme"] },
          { name: "misc", names: ["echo", "clear", "exit"] },
        ];
        for (const g of groups) {
          const rows = g.names
            .filter((n) => cmds[n] && !cmds[n].hidden)
            .map((n) => ({
              k: cmds[n].usage ? `${n} ${cmds[n].usage}` : n,
              v: cmds[n].desc,
            }));
          if (rows.length) ctx.rows(rows, g.name);
        }
      },
    },

    cd: {
      desc: "change directory",
      usage: "<dir>",
      args: () => [...SECTIONS.map((s) => s.dir), "~", ".."],
      run: (args, ctx) => {
        const dest = (args[0] || "")
          .toLowerCase()
          .replace(/^\.?\/+/, "")
          .replace(/\/+$/, "");

        if (!dest || dest === "~") {
          setNavPath([]);
          api.scrollToSection(""); // empty id → scroll to top
          ctx.ok("cd ~/");
          return;
        }
        if (dest === "..") {
          setNavPath([]);
          api.scrollToSection("");
          ctx.ok("cd ~/");
          return;
        }
        const section = sectionByDir.get(dest);
        if (!section) {
          ctx.err(`cd: no such directory: ${dest} — run \`ls\``);
          return;
        }
        setNavPath([section.dir]);
        api.scrollToSection(section.id);
        ctx.ok(`cd ~/${section.dir}`);
      },
    },

    ls: {
      desc: "list this directory",
      usage: "[projects]",
      args: ["projects"],
      run: (args, ctx) => {
        if ((args[0] || "").toLowerCase() === "projects") {
          const projects = api.getProjects();
          if (!projects.length) {
            ctx.out("no pinned repositories found.");
            return;
          }
          ctx.rows(
            projects.map((p) => ({
              k: projectKey(p.name),
              v: p.description || "—",
            })),
          );
          ctx.out(`${projects.length} repos · run \`open <name>\` to view`);
          return;
        }
        ctx.rows(SECTIONS.map((s) => ({ k: `${s.dir}/`, v: s.label })));
        ctx.out("`cd` into any of these · `ls projects` to list repos");
      },
    },

    pwd: {
      desc: "show current location",
      run: (_a, ctx) => {
        const p = getNavPath();
        ctx.out("~/" + (p.length ? p.join("/") : ""));
      },
    },

    whoami: {
      desc: "a quick intro",
      run: (_a, ctx) => {
        for (const line of WHOAMI_LINES) ctx.out(line);
      },
    },

    contact: {
      desc: "how to reach me",
      run: (_a, ctx) => ctx.rows(CONTACT_ROWS),
    },

    resume: {
      desc: "open my resume (pdf)",
      run: (_a, ctx) => {
        api.openUrl(LINKS.resume);
        ctx.ok("opening resume.pdf in a new tab");
      },
    },

    projects: {
      desc: "list pinned repos",
      run: (_a, ctx) => cmds.ls.run(["projects"], ctx),
    },

    open: {
      desc: "open a repo on github",
      usage: "<repo>",
      args: () => api.getProjects().map((p) => projectKey(p.name)),
      run: (args, ctx) => {
        const key = (args[0] || "").toLowerCase();
        const projects = api.getProjects();
        if (!key) {
          const first = projects[0] ? projectKey(projects[0].name) : "repo";
          ctx.err(`usage: open <repo> — try \`open ${first}\``);
          return;
        }
        const match = projects.find((p) => {
          const k = projectKey(p.name);
          return k === key || k.startsWith(key);
        });
        if (!match) {
          ctx.err(`no repo "${key}" — run \`ls projects\``);
          return;
        }
        api.openUrl(match.homepageUrl ?? match.url);
        ctx.ok(`opening ${match.name}`);
      },
    },

    github: {
      desc: "open github",
      run: (_a, ctx) => {
        api.openUrl(LINKS.github);
        ctx.ok("opening github");
      },
    },
    linkedin: {
      desc: "open linkedin",
      run: (_a, ctx) => {
        api.openUrl(LINKS.linkedin);
        ctx.ok("opening linkedin");
      },
    },
    email: {
      desc: "compose an email",
      run: (_a, ctx) => {
        api.openUrl(LINKS.email);
        ctx.ok("opening mail client");
      },
    },

    theme: {
      desc: "switch color theme",
      usage: "[dark|light]",
      args: ["dark", "light", "toggle"],
      run: (args, ctx) => {
        const arg = (args[0] || "toggle").toLowerCase();
        if (arg !== "dark" && arg !== "light" && arg !== "toggle") {
          ctx.err("usage: theme dark | light");
          return;
        }
        const next = api.setTheme(arg as ThemeMode | "toggle");
        ctx.ok(`theme set to ${next}`);
      },
    },

    echo: {
      desc: "print text",
      usage: "<text>",
      run: (args, ctx) => ctx.out(args.join(" ")),
    },
    clear: {
      desc: "clear the screen",
      run: (_a, ctx) => ctx.clear(),
    },
    exit: {
      desc: "close the terminal",
      run: (_a, ctx) => ctx.close(),
    },
  };

  return cmds;
}
