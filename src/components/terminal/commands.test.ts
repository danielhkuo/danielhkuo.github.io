import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCommands, welcomeLines, type Session } from "./commands.ts";
import { LINKS } from "./content.ts";
import { HOME, absPath, type Path } from "./fs.ts";
import { complete, execute } from "./shell.ts";
import { siteTree } from "./site.ts";
import type { CommandContext, ScreenProgram, SiteInfo, SlimProject, TerminalApi, ThemeMode } from "./types";

const REPOS: SlimProject[] = [
  {
    name: "zeta-tool",
    description: "A sample project showcasing modern web development",
    url: "https://github.com/danielhkuo/zeta-tool",
    homepageUrl: "https://example.com",
    primaryLanguage: { name: "TypeScript", color: "#3178c6" },
    languages: [
      { name: "TypeScript", percentage: 65.4 },
      { name: "CSS", percentage: 34.6 },
    ],
    stargazerCount: 42,
    forkCount: 7,
    updatedAt: "2026-09-08T12:00:00Z",
  },
  {
    name: "Alpha",
    description: "",
    url: "https://github.com/danielhkuo/Alpha",
    homepageUrl: null,
    primaryLanguage: null,
    languages: [],
    stargazerCount: 0,
    forkCount: 0,
    updatedAt: "2026-08-29T12:00:00Z",
  },
];

const SITE: SiteInfo = { builtAt: "2026-10-06T09:14:02Z", resumeBytes: 145439 };

/**
 * A shell session on the real commands and the real site tree. Only the edges
 * are stand-ins: the page (`opened`, `themes`), the window (`cols`) and the
 * state a React hook holds in the app (the working directory).
 */
function shell(cols = 80) {
  const opened: string[] = [];
  /** What the page was asked for, in order. Its system scheme is light. */
  const themes: string[] = [];
  const programs: ScreenProgram[] = [];
  let theme: ThemeMode = "dark";
  const api: TerminalApi = {
    openUrl: (url) => opened.push(url),
    getProjects: () => REPOS,
    getTheme: () => theme,
    setTheme: (mode) => {
      themes.push(mode);
      if (mode === "auto") theme = "light";
      else theme = mode === "toggle" ? (theme === "dark" ? "light" : "dark") : mode;
      return theme;
    },
    close: () => undefined,
    site: SITE,
  };

  let cwd: Path = HOME;
  let old: Path = HOME;
  const session: Session = {
    root: siteTree(REPOS, SITE),
    cwd: () => cwd,
    oldCwd: () => old,
    chdir: (path) => {
      old = cwd;
      cwd = path;
    },
  };
  const commands = buildCommands(api, session);

  /** Run a line; returns what it printed and what it complained about. */
  const run = (line: string) => {
    const out: string[] = [];
    const errs: string[] = [];
    const ctx: CommandContext = {
      out: (t) => out.push(t),
      ok: (t) => out.push(t),
      err: (t) => errs.push(t),
      rows: (rows) => out.push(...rows.map((r) => `${r.k}  ${r.v}`)),
      text: (rows) => out.push(...rows.map((runs) => runs.map((r) => r.text).join(""))),
      clear: () => undefined,
      close: () => undefined,
      program: (p) => programs.push(p),
      cols,
    };
    execute(line, commands, ctx);
    return { out, errs };
  };

  return { run, commands, opened, themes, pwd: () => absPath(cwd) };
}

// ---- cd, pwd ------------------------------------------------------------------

test("the shell starts in the home directory", () => {
  assert.deepEqual(shell().run("pwd"), { out: ["/Users/daniel"], errs: [] });
});

test("cd moves into a directory and prints nothing", () => {
  const sh = shell();
  assert.deepEqual(sh.run("cd projects"), { out: [], errs: [] });
  assert.equal(sh.pwd(), "/Users/daniel/projects");
  assert.deepEqual(sh.run("pwd").out, ["/Users/daniel/projects"]);
});

test("cd takes nested, parent, home-relative and absolute paths", () => {
  const sh = shell();
  sh.run("cd projects/zeta-tool");
  assert.equal(sh.pwd(), "/Users/daniel/projects/zeta-tool");
  sh.run("cd ..");
  assert.equal(sh.pwd(), "/Users/daniel/projects");
  sh.run("cd /Users");
  assert.equal(sh.pwd(), "/Users");
  sh.run("cd ~/projects/Alpha");
  assert.equal(sh.pwd(), "/Users/daniel/projects/Alpha");
});

test("cd with no argument goes home", () => {
  const sh = shell();
  sh.run("cd /");
  assert.equal(sh.pwd(), "/");
  assert.deepEqual(sh.run("cd"), { out: [], errs: [] });
  assert.equal(sh.pwd(), "/Users/daniel");
});

test("cd - goes back to the previous directory and prints where that is", () => {
  const sh = shell();
  sh.run("cd projects");
  assert.deepEqual(sh.run("cd -"), { out: ["~"], errs: [] });
  assert.equal(sh.pwd(), "/Users/daniel");
  assert.deepEqual(sh.run("cd -").out, ["~/projects"]);
  assert.equal(sh.pwd(), "/Users/daniel/projects");
});

test("cd lands on a directory's real name however it was typed", () => {
  const sh = shell();
  sh.run("cd PROJECTS/alpha");
  assert.equal(sh.pwd(), "/Users/daniel/projects/Alpha");
});

test("cd to a path that is not there says so as zsh does, and stays put", () => {
  const sh = shell();
  assert.deepEqual(sh.run("cd nope"), { out: [], errs: ["cd: no such file or directory: nope"] });
  assert.equal(sh.pwd(), "/Users/daniel");
});

test("cd to a file is refused", () => {
  const sh = shell();
  assert.deepEqual(sh.run("cd about.md").errs, ["cd: not a directory: about.md"]);
  assert.deepEqual(sh.run("cd about.md/x").errs, ["cd: not a directory: about.md/x"]);
  assert.equal(sh.pwd(), "/Users/daniel");
});

test("cd with two arguments is zsh's substitution, which has nothing to substitute", () => {
  const sh = shell();
  assert.deepEqual(sh.run("cd projects Alpha").errs, ["cd: string not in pwd: projects"]);
  assert.equal(sh.pwd(), "/Users/daniel");
});

// ---- ls -----------------------------------------------------------------------

test("ls lists what is in the working directory", () => {
  assert.deepEqual(shell().run("ls"), {
    out: ["about.md        contact.md      projects/       resume.pdf"],
    errs: [],
  });
});

test("ls follows cd", () => {
  const sh = shell();
  sh.run("cd projects");
  assert.deepEqual(sh.run("ls").out, ["Alpha/          zeta-tool/"]);
  assert.deepEqual(sh.run("ls zeta-tool").out, ["README.md"]);
});

test("ls fits its columns to the window", () => {
  assert.deepEqual(shell(30).run("ls").out, ["about.md", "contact.md", "projects/", "resume.pdf"]);
});

test("ls reports a missing path as an error, not as output", () => {
  assert.deepEqual(shell().run("ls nope"), { out: [], errs: ["ls: nope: No such file or directory"] });
});

// ---- cat ----------------------------------------------------------------------

test("cat prints a markdown file laid out, not as its source", () => {
  const { out, errs } = shell().run("cat about.md");
  assert.deepEqual(errs, []);
  assert.ok(out.includes("   Daniel Kuo "), JSON.stringify(out));
  assert.ok(!out.some((row) => /\*\*|^#/.test(row)), JSON.stringify(out));
});

test("cat wraps to the window it is printed in", () => {
  const widths = shell(40).run("cat about.md").out.map((row) => row.length);
  assert.ok(Math.max(...widths) <= 40, String(widths));
  assert.ok(Math.max(...widths) > 30, String(widths));
});

test("cat resolves its path from the working directory", () => {
  const sh = shell();
  sh.run("cd projects/zeta-tool");
  assert.ok(sh.run("cat README.md").out.includes("   zeta-tool "));
  assert.ok(sh.run("cat ../../contact.md").out.includes("   Contact "));
});

test("cat refuses a directory, a missing file and a path through a file", () => {
  const sh = shell();
  assert.deepEqual(sh.run("cat projects"), { out: [], errs: ["cat: projects: Is a directory"] });
  assert.deepEqual(sh.run("cat nope.md"), { out: [], errs: ["cat: nope.md: No such file or directory"] });
  assert.deepEqual(sh.run("cat about.md/x"), { out: [], errs: ["cat: about.md/x: Not a directory"] });
});

test("cat will not dump the PDF: it is an error, with no output", () => {
  const { out, errs } = shell().run("cat resume.pdf");
  assert.deepEqual(out, []);
  assert.equal(errs.length, 1);
  assert.match(errs[0], /^cat: resume\.pdf: /);
});

test("cat carries on past an operand it cannot read", () => {
  const { out, errs } = shell().run("cat nope.md contact.md");
  assert.deepEqual(errs, ["cat: nope.md: No such file or directory"]);
  assert.ok(out.includes("   Contact "));
});

test("cat with no operand is a usage error", () => {
  const { out, errs } = shell().run("cat");
  assert.deepEqual(out, []);
  assert.equal(errs.length, 1);
});

test("glow reads a file exactly as cat does", () => {
  const sh = shell();
  assert.deepEqual(sh.run("glow about.md"), sh.run("cat about.md"));
  assert.ok(sh.run("glow about.md").out.length > 0);
});

// ---- open ---------------------------------------------------------------------

test("open resume.pdf opens the PDF and prints nothing", () => {
  const sh = shell();
  assert.deepEqual(sh.run("open resume.pdf"), { out: [], errs: [] });
  assert.deepEqual(sh.opened, [LINKS.resume]);
});

test("open on a repo's directory, from outside or as . inside, opens the repository", () => {
  const sh = shell();
  sh.run("open projects/zeta-tool");
  sh.run("cd projects/zeta-tool");
  sh.run("open .");
  sh.run("open README.md");
  assert.deepEqual(sh.opened, [
    "https://github.com/danielhkuo/zeta-tool",
    "https://github.com/danielhkuo/zeta-tool",
    "https://github.com/danielhkuo/zeta-tool",
  ]);
});

test("open takes a web address or a mailbox as it is", () => {
  const sh = shell();
  assert.deepEqual(sh.run("open https://example.com/a?b=c"), { out: [], errs: [] });
  sh.run("open mailto:someone@example.com");
  assert.deepEqual(sh.opened, ["https://example.com/a?b=c", "mailto:someone@example.com"]);
});

test("open hands the browser nothing that is not a web address, a mailbox or a file here", () => {
  const sh = shell();
  const { errs } = sh.run("open javascript:alert(1)");
  assert.equal(errs.length, 1);
  assert.deepEqual(sh.opened, []);
});

test("open on a missing path opens nothing and says so", () => {
  const sh = shell();
  const { out, errs } = sh.run("open nope.pdf");
  assert.deepEqual(out, []);
  assert.equal(errs.length, 1);
  assert.match(errs[0], /nope\.pdf/);
  assert.deepEqual(sh.opened, []);
});

test("open on a text file with nothing behind it reads it in the terminal", () => {
  const sh = shell();
  const read = sh.run("open about.md");
  assert.ok(read.out.includes("   Daniel Kuo "), JSON.stringify(read));
  assert.deepEqual(read, sh.run("cat about.md"));
  assert.deepEqual(sh.opened, []);
});

test("open on a directory with nothing behind it is an error", () => {
  const sh = shell();
  const { out, errs } = sh.run("open /Users");
  assert.deepEqual(out, []);
  assert.equal(errs.length, 1);
  assert.deepEqual(sh.opened, []);
});

test("open with no operand is a usage error", () => {
  const sh = shell();
  assert.equal(sh.run("open").errs.length, 1);
  assert.deepEqual(sh.opened, []);
});

// ---- the rest -----------------------------------------------------------------

test("whoami prints the user name", () => {
  assert.deepEqual(shell().run("whoami"), { out: ["daniel"], errs: [] });
});

test("neofetch prints the host, the bio and the pinned repos", () => {
  const { out, errs } = shell().run("neofetch");
  assert.deepEqual(errs, []);
  assert.equal(out[0], "daniel@portfolio");
  assert.equal(out[1], "----------------");
  assert.ok(out.includes("Name: Daniel Kuo"), JSON.stringify(out));
  assert.ok(out.some((row) => row.startsWith("Pinned: ") && row.includes("zeta-tool") && row.includes("Alpha")));
});

test("theme switches the page's theme and says which it is now", () => {
  const sh = shell();
  assert.deepEqual(sh.run("theme light"), { out: ["theme set to light"], errs: [] });
  assert.deepEqual(sh.run("theme").out, ["theme set to dark"]);
  assert.deepEqual(sh.themes, ["light", "toggle"]);
});

test("theme auto hands the choice back to the system and says what that shows", () => {
  const sh = shell();
  sh.run("theme dark");
  assert.deepEqual(sh.run("theme auto"), { out: ["theme follows the system (light)"], errs: [] });
  assert.deepEqual(sh.themes, ["dark", "auto"]);
});

test("theme refuses a mode it does not have, and leaves the page alone", () => {
  const sh = shell();
  const { out, errs } = sh.run("theme purple");
  assert.deepEqual(out, []);
  assert.equal(errs.length, 1);
  assert.deepEqual(sh.themes, []);
});

test("theme completes its modes, auto among them", () => {
  assert.deepEqual(complete("theme a", shell().commands), { suffix: "uto", line: "theme auto" });
});

test("help lists every command a visitor can see", () => {
  const sh = shell();
  const listed = sh.run("help").out.map((row) => row.split(" ")[0]);
  const visible = Object.keys(sh.commands).filter((name) => !sh.commands[name].hidden);
  assert.deepEqual(
    visible.filter((name) => !listed.includes(name)),
    [],
  );
});

// ---- completion ---------------------------------------------------------------

test("cd completes directories only", () => {
  const sh = shell();
  assert.deepEqual(complete("cd ", sh.commands), { suffix: "projects/", line: "cd projects/" });
  assert.equal(complete("cd a", sh.commands), null);
});

test("cat, ls and open complete files as well", () => {
  const sh = shell();
  assert.deepEqual(complete("cat a", sh.commands), { suffix: "bout.md", line: "cat about.md" });
  assert.deepEqual(complete("ls -l pro", sh.commands), { suffix: "jects/", line: "ls -l projects/" });
  assert.deepEqual(complete("open re", sh.commands), { suffix: "sume.pdf", line: "open resume.pdf" });
});

test("a completed directory carries on into what it holds", () => {
  const sh = shell();
  assert.deepEqual(complete("cat projects/", sh.commands), {
    suffix: "Alpha/",
    line: "cat projects/Alpha/",
  });
  assert.deepEqual(complete("cat projects/z", sh.commands), {
    suffix: "eta-tool/",
    line: "cat projects/zeta-tool/",
  });
  assert.deepEqual(complete("cat projects/zeta-tool/", sh.commands), {
    suffix: "README.md",
    line: "cat projects/zeta-tool/README.md",
  });
});

test("paths complete from wherever cd has gone", () => {
  const sh = shell();
  sh.run("cd projects/zeta-tool");
  const commands = sh.commands;
  assert.deepEqual(complete("cat R", commands), { suffix: "EADME.md", line: "cat README.md" });
  assert.deepEqual(complete("cd ../a", commands), { suffix: "lpha/", line: "cd ../Alpha/" });
});

// ---- welcome ------------------------------------------------------------------

test("the session opens the way Terminal does, with the last login in local time", () => {
  const lines = welcomeLines(new Date(2026, 9, 6, 9, 4, 2));
  assert.deepEqual(lines[0], { kind: "out", text: "Last login: Tue Oct  6 09:04:02 on ttys000" });
});

test("the welcome points a newcomer at ls and help", () => {
  const hint = welcomeLines(new Date(2026, 9, 6, 9, 4, 2))
    .slice(1)
    .map((line) => (line.kind === "out" ? line.text : ""))
    .join(" ");
  assert.match(hint, /`ls`/);
  assert.match(hint, /`help`/);
});
