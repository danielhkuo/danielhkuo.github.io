// Command registry. Pure logic — handlers emit data through `ctx`, never JSX.
// The path commands work on the filesystem in fs.ts through a `Session`: the
// tree, and the working directory the shell holds for them. They behave as
// their namesakes do in zsh on a Mac, down to the wording of the errors.

import { EMAIL, LINKS, PROFILE } from "./content.ts";
import { HOME, absPath, completions, lookup, strerror, tildePath, type DirNode, type Path } from "./fs.ts";
import { ls } from "./ls.ts";
import { isWebLink, renderMarkdown } from "./markdown.ts";
import type { Command, CommandMap, TerminalApi, TerminalLine, TextRun } from "./types";

/** The shell's place in the filesystem, as the path commands read and move it. */
export interface Session {
  root: DirNode;
  cwd(): Path;
  /** Where `cd -` goes back to. */
  oldCwd(): Path;
  chdir(path: Path): void;
}

const USER = HOME[1];
const HOST = "portfolio";

// neofetch's colours, as the header draws them: systemCyan for user@host,
// systemGray for the keys (their nearest xterm-256 neighbours).
const NF_TITLE = 81;
const NF_KEY = 246;

/** "Tue Oct  6 09:14:02": a moment as `login` stamps it, in local time. */
function loginStamp(now: Date): string {
  const weekday = now.toLocaleDateString("en-US", { weekday: "short" });
  const month = now.toLocaleDateString("en-US", { month: "short" });
  const two = (n: number) => String(n).padStart(2, "0");
  const time = `${two(now.getHours())}:${two(now.getMinutes())}:${two(now.getSeconds())}`;
  return `${weekday} ${month} ${String(now.getDate()).padStart(2)} ${time}`;
}

/** What a new session opens with (and `clear` alone removes): Terminal's login line, then a way in. */
export function welcomeLines(now: Date): TerminalLine[] {
  return [
    { kind: "out", text: `Last login: ${loginStamp(now)} on ttys000` },
    // Short enough for a phone's 52 columns.
    { kind: "out", text: "`ls` to look around · `cat` to read · `help` for more" },
  ];
}

/** `neofetch` without the logo: user@host, the bio, the pinned repos, the colour blocks. */
function neofetch(api: TerminalApi): TextRun[][] {
  const title: TextRun[] = [
    { text: USER, fg: NF_TITLE, bold: true },
    { text: "@" },
    { text: HOST, fg: NF_TITLE, bold: true },
  ];
  const row = (key: string, ...value: TextRun[]): TextRun[] => [
    { text: key, fg: NF_KEY, bold: true },
    { text: ": " },
    ...value,
  ];
  const link = (text: string, href: string): TextRun => ({ text, underline: true, href });
  const blocks = (from: number): TextRun[] =>
    Array.from({ length: 8 }, (_, i) => ({ text: "   ", bg: from + i }));

  const rows: TextRun[][] = [
    title,
    [{ text: "-".repeat(USER.length + 1 + HOST.length) }],
    row("Name", { text: PROFILE.name }),
    row("Title", { text: PROFILE.title }),
    row("Previously", { text: PROFILE.previously }),
    row("School", { text: PROFILE.school }),
    row("Location", { text: PROFILE.location }),
  ];
  const pinned = api.getProjects().flatMap((p, i) => [...(i ? [{ text: " · " }] : []), link(p.name, p.url)]);
  if (pinned.length) rows.push(row("Pinned", ...pinned));
  rows.push(
    row("Contact", link(EMAIL, LINKS.email), { text: " · " }, link("resume.pdf", LINKS.resume)),
    [],
    blocks(0),
    blocks(8),
    [],
  );
  return rows;
}

export function buildCommands(api: TerminalApi, session: Session): CommandMap {
  const find = (path: string) => lookup(session.root, session.cwd(), path);
  /** Tab completion for a path argument. */
  const paths = (only?: "dir") => (typed: string) => completions(session.root, session.cwd(), typed, only);

  const cat: Command = {
    desc: "read a file",
    usage: "<file>",
    args: paths(),
    run: (args, ctx) => {
      if (!args.length) {
        ctx.err("usage: cat file ...");
        return;
      }
      for (const operand of args) {
        const found = find(operand);
        if ("errno" in found) ctx.err(`cat: ${operand}: ${strerror(found.errno)}`);
        else if (found.node.kind === "dir") ctx.err(`cat: ${operand}: Is a directory`);
        else if (found.node.text === undefined) ctx.err(`cat: ${operand}: not a text file — try \`open ${operand}\``);
        else ctx.text(renderMarkdown(found.node.text, ctx.cols));
      }
    },
  };

  const cmds: CommandMap = {
    help: {
      desc: "list commands",
      run: (_args, ctx) => {
        ctx.out("`tab` completes a command or a path · `↑` brings back the last line");
        const groups: { name: string; names: string[] }[] = [
          { name: "files", names: ["ls", "cd", "pwd", "cat", "open"] },
          { name: "programs", names: ["neofetch", "work", "cbonsai", "claude"] },
          { name: "shell", names: ["theme", "whoami", "echo", "clear", "exit", "help"] },
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

    ls: {
      desc: "list a directory",
      usage: "[-la] [path]",
      args: paths(),
      run: (args, ctx) => {
        const listing = ls(args, { root: session.root, cwd: session.cwd(), cols: ctx.cols, now: new Date() });
        for (const error of listing.errors) ctx.err(error);
        if (listing.rows.length) ctx.text(listing.rows);
      },
    },

    cd: {
      desc: "change directory",
      usage: "[dir]",
      args: paths("dir"),
      run: (args, ctx) => {
        // zsh reads two arguments as "replace the first with the second in $PWD".
        if (args.length > 1) {
          ctx.err(`cd: string not in pwd: ${args[0]}`);
          return;
        }
        const target = args[0] ?? "~";
        if (target === "-") {
          const back = session.oldCwd();
          session.chdir(back);
          ctx.out(tildePath(back));
          return;
        }
        const found = find(target);
        if ("errno" in found) ctx.err(`cd: ${strerror(found.errno).toLowerCase()}: ${target}`);
        else if (found.node.kind !== "dir") ctx.err(`cd: not a directory: ${target}`);
        else session.chdir(found.path);
      },
    },

    pwd: {
      desc: "print the working directory",
      run: (_args, ctx) => ctx.out(absPath(session.cwd())),
    },

    cat,
    // What `cat` does here is glow's job in a real terminal; answer to its name too.
    glow: { ...cat, hidden: true },

    open: {
      desc: "open a file, a repo or a link in the browser",
      usage: "<path|url>",
      args: paths(),
      run: (args, ctx) => {
        if (!args.length) {
          ctx.err("usage: open <file | directory | url>");
          return;
        }
        for (const target of args) {
          if (isWebLink(target)) {
            api.openUrl(target);
            continue;
          }
          const found = find(target);
          if ("errno" in found) ctx.err(`The file ${target} does not exist.`);
          else if (found.node.url) api.openUrl(found.node.url);
          // A text file with nothing behind it opens in the only viewer there is.
          else if (found.node.kind === "file" && found.node.text !== undefined) {
            ctx.text(renderMarkdown(found.node.text, ctx.cols));
          } else ctx.err(`No application knows how to open ${tildePath(found.path)}.`);
        }
      },
    },

    neofetch: {
      desc: "who this is, at a glance",
      run: (_args, ctx) => ctx.text(neofetch(api)),
    },

    work: {
      desc: "browse pinned repos · `↑↓` move · `⏎` open · `/` filter · `q` quit",
      run: (_args, ctx) => {
        const projects = api.getProjects();
        if (!projects.length) {
          ctx.out("no pinned repositories found.");
          return;
        }
        void import("./work/program")
          .then((m) => ctx.program(m.createWorkProgram(projects, api)))
          .catch(() => ctx.err("work: failed to load"));
      },
    },
    cbonsai: {
      desc: "grow a bonsai tree · `-l` live · `-i` infinite · `-h` help",
      usage: "[options]",
      args: [
        "--live",
        "--infinite",
        "--screensaver",
        "--message",
        "--seed",
        "--life",
        "--multiplier",
        "--base",
        "--leaf",
        "--colors",
        "--time",
        "--wait",
        "--help",
        "-p",
      ],
      run: (args, ctx) => {
        // Loaded on first use so the tree generator stays out of the page bundle.
        void import("./cbonsai/program")
          .then((m) => m.runCbonsai(args, ctx))
          .catch(() => ctx.err("cbonsai: failed to load"));
      },
    },
    claude: {
      desc: "start claude code (results may vary · `/exit` or ctrl-c twice to leave)",
      run: (_args, ctx) => {
        void import("./claude/program")
          .then((m) => ctx.program(m.createClaudeProgram()))
          .catch(() => ctx.err("claude: failed to load"));
      },
    },

    theme: {
      desc: "switch color theme · `auto` follows the system again",
      usage: "[dark|light|auto]",
      args: ["dark", "light", "auto", "toggle"],
      run: (args, ctx) => {
        const arg = (args[0] || "toggle").toLowerCase();
        if (arg !== "dark" && arg !== "light" && arg !== "auto" && arg !== "toggle") {
          ctx.err("usage: theme dark | light | auto");
          return;
        }
        const next = api.setTheme(arg);
        ctx.ok(arg === "auto" ? `theme follows the system (${next})` : `theme set to ${next}`);
      },
    },
    whoami: {
      desc: "print the user name",
      run: (_args, ctx) => ctx.out(USER),
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
