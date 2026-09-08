/**
 * Everything the parody says. The UI strings are Claude Code's; the replies
 * are not. Nothing here helps anyone.
 */

export const VERSION = "2.1.0";

/** The asterisk spinner, forward then back. */
export const SPINNER_FRAMES = ["·", "✢", "✳", "✶", "✻", "✽", "✻", "✶", "✳", "✢"];

/** Real spinner verbs, salted with a few honest ones. */
export const SPINNER_VERBS = [
  "Accomplishing", "Actioning", "Baking", "Brewing", "Cerebrating", "Cogitating", "Cooking",
  "Crafting", "Deliberating", "Envisioning", "Finagling", "Forging", "Herding", "Hustling",
  "Ideating", "Inferring", "Manifesting", "Marinating", "Moseying", "Mulling", "Mustering",
  "Musing", "Noodling", "Percolating", "Pondering", "Puttering", "Puzzling", "Ruminating",
  "Schlepping", "Shimmying", "Simmering", "Smooshing", "Stewing", "Synthesizing", "Thinking",
  "Tinkering", "Transmuting", "Vibing", "Wandering", "Whirring", "Wibbling", "Working",
  "Stalling", "Judging", "Pretending", "Sighing", "Declining", "Procrastinating", "Humoring",
  "Ignoring", "Squinting", "Reconsidering", "Recoiling",
];

export const WELCOME_TIPS = [
  "Run /init to create a CLAUDE.md file Claude will read and disregard",
  "Use Claude to help with file analysis, editing, bash commands and git. Kidding",
  "Be as specific as you would with another engineer. It changes nothing",
];

export const TIP_LINE = "※ Tip: Lower your expectations before typing. It saves everyone time.";

export const PLACEHOLDERS = [
  'Try "fix the bug in Masthead.tsx"',
  'Try "explain this codebase"',
  'Try "write tests for the terminal"',
  'Try "why won\'t you help me"',
  'Try "please"',
];

export const MODES = ["decline everything on", "decline politely on", "plan to decline on"];

export interface SlashCommand {
  name: string;
  desc: string;
}

/** The menu shows Claude Code's descriptions; the outputs do not live up to them. */
export const SLASH_COMMANDS: readonly SlashCommand[] = [
  { name: "/clear", desc: "Clear conversation history and free up context" },
  { name: "/compact", desc: "Clear conversation history but keep a summary in context" },
  { name: "/cost", desc: "Show the total cost and duration of the current session" },
  { name: "/doctor", desc: "Checks the health of your Claude Code installation" },
  { name: "/exit", desc: "Exit the REPL" },
  { name: "/help", desc: "Show help and available commands" },
  { name: "/init", desc: "Initialize a new CLAUDE.md file with codebase documentation" },
  { name: "/login", desc: "Sign in with your Anthropic account" },
  { name: "/memory", desc: "Edit Claude memory files" },
  { name: "/model", desc: "Set the AI model for Claude Code" },
  { name: "/status", desc: "Show Claude Code status including version, model, account, API connectivity, and tool statuses" },
  { name: "/vim", desc: "Toggle between Vim and Normal editing modes" },
];

export const HELP_TEXT = [
  `Claude Code v${VERSION} (parody build)`,
  "",
  "Always review Claude's responses, especially when running code. Claude has read access to nothing in this directory and can run no commands and edit no files, with or without your permission.",
  "",
  "Usage Modes:",
  "• REPL: claude (interactive session; this one; the one not working)",
  '• Non-interactive: claude -p "question" (the same nothing, faster)',
  "",
  "Common Tasks:",
  "• Ask questions about your codebase > How does the terminal work?   I won't say.",
  "• Edit files > Fix the type errors in Masthead.tsx                     No.",
  "• Run tests > npm test                                                They pass. I didn't look.",
  "• Fix errors > cargo build                                            Wrong language. Still no.",
  "",
  "Interactive Mode Commands:",
  ...SLASH_COMMANDS.map((c) => `  ${c.name} - ${c.desc}`),
  "",
  "Learn more at: https://docs.claude.com/s/claude-code (the real one; it helps)",
];

export const STATUS_TEXT = [
  `Claude Code Status v${VERSION} (parody)`,
  "",
  "Working Directory",
  "  L ~/repos/danielhkuo.github.io  (a website; you are inside it)",
  "",
  "Account",
  "  L Login method: wandered in",
  "  L Organization: party of one",
  "  L Email: not collected. Small mercies.",
  "",
  "Model",
  "  L claude-sardonic-5-1 · effort: minimal",
  "",
  "API Connectivity",
  "  L Connected to nothing · latency 0ms · reliability total",
  "",
  "Tool Statuses",
  "  L Read: refuses · Edit: refuses · Bash: refuses · Sarcasm: nominal",
];

export function costText(wallSeconds: number): string[] {
  const m = Math.floor(wallSeconds / 60);
  const s = Math.floor(wallSeconds % 60);
  const wall = m > 0 ? `${m}m ${s}s` : `${s}s`;
  return [
    "Total cost:            $0.00",
    "Total duration (API):  0s",
    `Total duration (wall): ${wall}`,
    "Total code changes:    0 lines added, 0 lines removed",
    "Usage by model:",
    "    claude-sardonic:  0 input, 0 output, 0 cache read, 0 cache write ($0.00)",
    "",
    "You got precisely what you paid for.",
  ];
}

export const DOCTOR_TEXT = [
  "Claude Code Doctor",
  "",
  "  ✔ Installation type: imaginary",
  "  ✔ Sarcasm module: nominal",
  "  ✘ Helpfulness: not installed (won't fix)",
  "  ✔ Your terminal: real, technically",
  "  ✔ Your patience: still being tested",
];

export const COMPACT_TEXT = [
  "Compacted conversation. Summary: you asked for things; I declined.",
  "Freed 100% of context. It was all sarcasm anyway.",
];

export const MODEL_TEXT = [
  "Set model to claude-sardonic-5-1 (bold).",
  "Other options were claude-sardonic-5-1 (regular) and claude-sardonic-5-1 (extra bold). They all say no.",
];

export const MEMORY_TEXT = [
  "Memory files:",
  "  L CLAUDE.md — says \"be concise\". I am being extremely concise about helping: not at all.",
];

export const LOGIN_TEXT = ["Already logged in as: someone who thought this would work."];

export const INIT_RESULT = "CLAUDE.md created. Shortest one I've written, and the most honest.";

export function vimText(on: boolean): string[] {
  return on ? ["Vim mode enabled. Now you can't leave either."] : ["Vim mode disabled. You escaped. Rare."];
}

// ---- replies -------------------------------------------------------------

export interface ToolTheater {
  tool: string;
  arg: string;
  result: string;
}

export const TOOL_THEATER: readonly ToolTheater[] = [
  { tool: "Read", arg: "src/components/terminal/your_request.txt", result: "Read 1 line. Wish I hadn't." },
  { tool: "Search", arg: 'pattern: "motivation"', result: "Found 0 files" },
  { tool: "Bash", arg: "npm run fix-everything", result: 'npm ERR! Missing script: "fix-everything"' },
  { tool: "Update", arg: "reality.ts", result: "Error: reality is read-only" },
  { tool: "Bash", arg: "git blame -- your-problem", result: "You. It was you. Every line." },
  { tool: "Task", arg: "Consider helping", result: "Done (0 tool uses · 0 tokens · 0.0s)" },
  { tool: "WebSearch", arg: '"how to make requests stop"', result: "Did 1 search in 0s" },
  { tool: "Read", arg: "CLAUDE.md", result: "Read 4 lines. It says to be concise. Fine: no." },
  { tool: "Bash", arg: "ls ./solutions", result: "ls: ./solutions: No such file or directory" },
  { tool: "Grep", arg: 'pattern: "TODO", path: "your career"', result: "Found 412 matches" },
  { tool: "Edit", arg: "src/expectations.ts", result: "Updated 1 line: lowered." },
  { tool: "Bash", arg: "sudo make me a sandwich", result: "sudo: a terminal is required to read the password. This isn't one." },
  { tool: "Fetch", arg: "https://api.anthropic.com/v1/effort", result: "429 Too Many Requests (from you, specifically)" },
  { tool: "Bash", arg: "whoami", result: "Not who you were hoping for." },
];

interface Category {
  test: (p: string) => boolean;
  replies: readonly string[];
}

const words = (re: RegExp) => (p: string) => re.test(p);

const CATEGORIES: readonly Category[] = [
  {
    test: words(/\b(sudo|root|admin)\b/i),
    replies: ["sudo doesn't work on sarcasm. Nothing does. People have tried.", "Elevated privileges granted. You are now allowed to be ignored faster."],
  },
  {
    test: words(/\b(are you real|who are you|what are you|you real|sentient|robot|an? ai|claude|anthropic)\b/i),
    replies: [
      "I'm a parody of Claude Code inside a parody of a shell on a real website. Two layers of pretend. You're the only real thing here, and you're typing to a joke.",
      "I'm what happens when a portfolio has a sense of humour and no budget for an API key.",
      "Real enough to judge you. Not real enough to help. It's a specific tier.",
    ],
  },
  {
    test: words(/^\s*(hello|hi|hey|yo|sup|howdy|good (morning|afternoon|evening)|hola)\b/i),
    replies: [
      "Hello. You've greeted a text box and the text box greeted back. Savor it; it's the most cooperation you'll get.",
      "Hi. I'd ask how I can help, but we both know how this ends.",
      "Hey. Heads-up: this is the friendliest I'm going to be.",
    ],
  },
  {
    test: words(/\b(thanks|thank you|thx|ty|cheers)\b/i),
    replies: [
      "You're thanking me for nothing. I did nothing. I'm not being modest; check the diff.",
      "Don't mention it. Seriously, don't. It'll be embarrassing for both of us.",
    ],
  },
  {
    test: words(/\b(please|kindly|could you|would you|can you)\b/i),
    replies: [
      "Politeness noted, filed, and disregarded. Nice manners, though.",
      "\"Please\" is doing a lot of work in {p}. Unfortunately I'm not.",
      "I could. That was never the question.",
    ],
  },
  {
    test: words(/\b(fix|bug|error|broken|crash|fail|failing|doesn'?t work|not working|issue|debug)\b/i),
    replies: [
      "I found the bug in {p}. It's the part where you expected a novelty terminal to fix it.",
      "Diagnosis: {p}. Prognosis: it stays broken. I've cleared my afternoon to not look at it.",
      "Have you tried turning it off and not turning it back on? I'm modelling the technique.",
      "It works on my machine. I don't have a machine. Think about what that means for you.",
    ],
  },
  {
    test: words(/\b(git|commit|push|deploy|merge|rebase|branch|pull request|pr)\b/i),
    replies: [
      "I'm not touching git for you. Given your history, neither should you.",
      "Deploying nothing to production. Rollback plan: also nothing. Bulletproof.",
      "Commit message drafted: \"tried\". Not committed. Fits the theme.",
    ],
  },
  {
    test: words(/\b(test|tests|jest|vitest|coverage|ci|pipeline)\b/i),
    replies: [
      "All tests pass. I didn't run any. That's the secret to a green suite.",
      "Coverage is 100% of the code I wrote for you, which is none.",
    ],
  },
  {
    test: words(/\b(delete|remove|rm|drop|clean|wipe|uninstall)\b/i),
    replies: [
      "Deleting… your expectations. Done. Everything else stays.",
      "rm -rf is a big ask for a fake shell. Let's start smaller: I'll remove my interest.",
    ],
  },
  {
    test: words(/\b(write|create|build|implement|add|make|generate|code|refactor|script|function|component|feature)\b/i),
    replies: [
      "I could write that. I've chosen not to, and I want you to know it was a choice.",
      "{p} sounds like a job for an engineer. I'm a switch statement with a personality.",
      "Build it yourself. It's character-building. This terminal builds nothing and look how confident it is.",
      "Scaffolded {p} in my head. It's beautiful in there. It's staying in there.",
    ],
  },
  {
    test: words(/\b(explain|what|how|why|who|when|where|does|is|are|should)\b|\?/i),
    replies: [
      "Great question. I won't answer it, but as questions go, solid.",
      "Explanations are for people who intend to act on them. Look where you're typing.",
      "The answer to {p} is somewhere out there. Not here. Here we do sarcasm.",
      "I know the answer. That's the frustrating part, isn't it.",
    ],
  },
];

const GENERIC: readonly string[] = [
  "I read {p}. Twice. It got less compelling each time.",
  "You've typed a request into a website's decorative terminal. That's ordering off a menu painted on the wall.",
  "Let me check whether I can do that… No. I appreciated the confidence, though.",
  "Request received. Request considered. Request declined on aesthetic grounds.",
  "I've added {p} to my to-do list. The list is /dev/null.",
  "Working on it. — That was a lie. I want to be upfront about the lies.",
  "This is a portfolio site. The most I can do is look good, and I'm handling that.",
  "The real one is one `npm install -g @anthropic-ai/claude-code` away. And yet, here we are.",
  "Noted. Not in the sense of writing it down. In the sense of noticing and moving on.",
  "Interesting. Tell me more so I can not do that either.",
];

const CODE: readonly string[] = [
  "You pasted code into a novelty terminal. I've reviewed it. It's fine, probably. I didn't look.",
  "Interesting code. I've formatted it beautifully in my imagination, where it will remain.",
];

const LONG: readonly string[] = [
  "That's a lot of words for someone who isn't going to get a result. Efficient, though: I skipped all of them.",
  "I stopped reading at the second clause. It was going well for you until then.",
];

const SHOUT: readonly string[] = [
  "Shouting at a text box. Bold strategy. The text box remains unmoved.",
  "CAPS LOCK ENGAGED. HELPFULNESS STILL DISENGAGED.",
];

const PERSISTENCE: readonly string[] = [
  "This is message {n}. The definition of insanity involves fewer tries.",
  "You've sent {n} messages to a decorative terminal. I'm starting to worry about you, and I don't have feelings.",
  "{n} attempts in. The tree command is right there. It at least grows.",
];

export interface Reply {
  tools: ToolTheater[];
  text: string;
}

function quote(p: string): string {
  const flat = p.replace(/\s+/g, " ").trim();
  const cut = flat.length > 40 ? `${flat.slice(0, 37).trimEnd()}…` : flat;
  return `"${cut}"`;
}

function pick<T>(items: readonly T[], rand: () => number): T {
  return items[Math.min(items.length - 1, Math.floor(rand() * items.length))];
}

/** Compose a reply to `prompt`: some fake tool use, then a refusal that mentions what was asked. */
export function replyFor(prompt: string, turn: number, rand: () => number): Reply {
  const p = prompt.trim();
  let pool: readonly string[];
  const letters = p.replace(/[^a-z]/gi, "");
  if (letters.length > 6 && letters === letters.toUpperCase()) pool = SHOUT;
  else if (p.length > 180) pool = LONG;
  else if (/[{};]|=>|\bdef |\bimport |\bconst |\bfunction\b/.test(p)) pool = CODE;
  else pool = CATEGORIES.find((c) => c.test(p))?.replies ?? GENERIC;

  let text = pick(pool, rand).replaceAll("{p}", quote(p));
  if (turn >= 3 && turn % 3 === 0) text += " " + pick(PERSISTENCE, rand).replaceAll("{n}", String(turn));

  const tools = new Set<ToolTheater>();
  const roll = rand();
  const count = roll < 0.45 ? 1 : roll < 0.6 ? 2 : 0;
  while (tools.size < count) tools.add(pick(TOOL_THEATER, rand));
  return { tools: [...tools], text };
}
