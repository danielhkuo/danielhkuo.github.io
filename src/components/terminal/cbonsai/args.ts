/**
 * cbonsai's command line, parsed the way its `main()` does with getopt_long:
 * the same optstring, the same long-option table (including its quirk that
 * `--print` declares a required argument), prefix-matched long options,
 * clustered short flags, and the same validation and error strings.
 */
import { DEFAULT_COLORS } from "./colors.ts";

export interface Config {
  live: boolean;
  infinite: boolean;
  screensaver: boolean;
  printTree: boolean;
  verbosity: number;
  lifeStart: number;
  multiplier: number;
  baseType: number;
  seed: number;
  leaves: string[];
  /** xterm indices: dark leaves, dark wood, light leaves, light wood. */
  colors: [number, number, number, number];
  save: boolean;
  load: boolean;
  saveFile: string;
  loadFile: string;
  targetBranchCount: number;
  /** Seconds between trees in infinite mode. */
  timeWait: number;
  /** Seconds between growth steps in live mode. */
  timeStep: number;
  message: string | null;
}

export type ParseResult =
  | { kind: "run"; config: Config }
  | { kind: "help" }
  | { kind: "error"; message: string; help: boolean };

/** `$HOME/.cache/cbonsai`, spelled the way the shell shows it. */
export const DEFAULT_CACHE_PATH = "~/.cache/cbonsai";

export function defaultConfig(): Config {
  return {
    live: false,
    infinite: false,
    screensaver: false,
    printTree: false,
    verbosity: 0,
    lifeStart: 32,
    multiplier: 5,
    baseType: 1,
    seed: 0,
    leaves: ["&"],
    colors: [...DEFAULT_COLORS],
    save: false,
    load: false,
    saveFile: DEFAULT_CACHE_PATH,
    loadFile: DEFAULT_CACHE_PATH,
    targetBranchCount: 0,
    timeWait: 4,
    timeStep: 0.03,
    message: null,
  };
}

export const HELP_LINES: readonly string[] = [
  "Usage: cbonsai [OPTION]...",
  "",
  "cbonsai is a beautifully random bonsai tree generator.",
  "",
  "Options:",
  "  -l, --live             live mode: show each step of growth",
  "  -t, --time=TIME        in live mode, wait TIME secs between",
  "                           steps of growth (must be larger than 0) [default: 0.03]",
  "  -i, --infinite         infinite mode: keep growing trees",
  "  -w, --wait=TIME        in infinite mode, wait TIME between each tree",
  "                           generation [default: 4.00]",
  "  -S, --screensaver      screensaver mode; equivalent to -li and",
  "                           quit on any keypress",
  "  -m, --message=STR      attach message next to the tree",
  "  -b, --base=INT         ascii-art plant base to use, 0 is none",
  "  -c, --leaf=LIST        list of comma-delimited strings randomly chosen",
  "                           for leaves [default: &]",
  "  -k, --color=LIST       list of 4 comma-delimited color indices (0-255) for",
  "                           each of dark leaves, dark wood, light leaves, and",
  "                           light wood, in that order [default: 2,3,10,11]",
  "  -M, --multiplier=INT   branch multiplier; higher -> more",
  "                           branching (0-20) [default: 5]",
  "  -L, --life=INT         life; higher -> more growth (0-200) [default: 32]",
  "  -p, --print            print tree to terminal when finished",
  "  -s, --seed=INT         seed random number generator",
  "  -W, --save=FILE        save progress to file [default: $XDG_CACHE_HOME/cbonsai or $HOME/.cache/cbonsai]",
  "  -C, --load=FILE        load progress from file [default: $XDG_CACHE_HOME/cbonsai]",
  "  -v, --verbose          increase output verbosity",
  "  -h, --help             show help",
];

// ---- C library number parsing -------------------------------------------

const STRTOD_RE =
  /^[ \t\n\v\f\r]*([+-]?)(?:0[xX](?:([0-9a-fA-F]+)\.?([0-9a-fA-F]*)|\.([0-9a-fA-F]+))(?:[pP]([+-]?\d+))?|((?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)|(inf(?:inity)?)|(nan))/i;

/** `strtod`: the longest numeric prefix, or 0 when there is none. */
export function strtod(s: string): number {
  const m = STRTOD_RE.exec(s);
  if (!m) return 0;
  const sign = m[1] === "-" ? -1 : 1;
  if (m[6] !== undefined) return sign * Number(m[6]);
  if (m[7] !== undefined) return sign * Infinity;
  if (m[8] !== undefined) return NaN;
  const intHex = m[2] ?? "";
  const fracHex = m[3] ?? m[4] ?? "";
  let v = intHex ? parseInt(intHex, 16) : 0;
  if (fracHex) v += parseInt(fracHex, 16) / 16 ** fracHex.length;
  if (m[5] !== undefined) v *= 2 ** Number(m[5]);
  return sign * v;
}

/** `(int)` of a double: truncation, with out-of-range values folding to INT_MIN as x86 does. */
export function toInt(v: number): number {
  if (!Number.isFinite(v) || v >= 2147483648 || v < -2147483648) return -2147483648;
  return Math.trunc(v);
}

const STRTOL0_RE = /^[ \t\n\v\f\r]*([+-]?)(?:0[xX]([0-9a-fA-F]+)|(0[0-7]*)|([1-9]\d*))$/;

/** `strtol(s, &end, 0)` requiring the whole string to be consumed; null otherwise. */
export function strtolExact(s: string): number | null {
  const m = STRTOL0_RE.exec(s);
  if (!m) return null;
  const sign = m[1] === "-" ? -1 : 1;
  let v: number;
  if (m[2] !== undefined) v = parseInt(m[2], 16);
  else if (m[3] !== undefined) v = parseInt(m[3], 8);
  else v = parseInt(m[4], 10);
  return sign * v;
}

// ---- getopt_long ----------------------------------------------------------

const OPTSTRING = ":lt:iw:Sm:b:c:k:M:L:ps:C:W:vh";

interface LongOpt {
  name: string;
  hasArg: boolean;
  val: string;
}

const LONG_OPTIONS: readonly LongOpt[] = [
  { name: "live", hasArg: false, val: "l" },
  { name: "time", hasArg: true, val: "t" },
  { name: "infinite", hasArg: false, val: "i" },
  { name: "wait", hasArg: true, val: "w" },
  { name: "screensaver", hasArg: false, val: "S" },
  { name: "message", hasArg: true, val: "m" },
  { name: "base", hasArg: true, val: "b" },
  { name: "leaf", hasArg: true, val: "c" },
  { name: "colors", hasArg: true, val: "k" },
  { name: "multiplier", hasArg: true, val: "M" },
  { name: "life", hasArg: true, val: "L" },
  { name: "print", hasArg: true, val: "p" },
  { name: "seed", hasArg: true, val: "s" },
  { name: "save", hasArg: true, val: "W" },
  { name: "load", hasArg: true, val: "C" },
  { name: "verbose", hasArg: false, val: "v" },
  { name: "help", hasArg: false, val: "h" },
];

/** One getopt return: an option with its argument, or `:`/`?` with `optopt`. */
interface Opt {
  c: string;
  optarg: string | null;
  optopt: string;
}

function shortTakesArg(c: string): boolean | null {
  const i = OPTSTRING.indexOf(c, 1);
  if (i < 0 || c === ":") return null;
  return OPTSTRING[i + 1] === ":";
}

/**
 * A getopt_long cursor over argv. Non-options are skipped (GNU permutation),
 * `--` ends option parsing, and `optind` can be stepped back by one after an
 * option consumed a separate argument, as cbonsai does for -W/-C.
 */
class Getopt {
  optind = 0;
  private cluster: string | null = null;
  private clusterPos = 0;
  private done = false;
  private readonly argv: readonly string[];

  constructor(argv: readonly string[]) {
    this.argv = argv;
  }

  next(): Opt | null {
    if (this.cluster !== null) return this.shortOpt();
    while (!this.done) {
      if (this.optind >= this.argv.length) return null;
      const arg = this.argv[this.optind];
      if (arg === "--") {
        this.optind++;
        this.done = true;
        return null;
      }
      if (arg.length < 2 || arg[0] !== "-") {
        this.optind++;
        continue;
      }
      this.optind++;
      if (arg[1] === "-") return this.longOpt(arg.slice(2));
      this.cluster = arg;
      this.clusterPos = 1;
      return this.shortOpt();
    }
    return null;
  }

  private shortOpt(): Opt {
    const cluster = this.cluster as string;
    const c = cluster[this.clusterPos++];
    const rest = cluster.slice(this.clusterPos);
    if (this.clusterPos >= cluster.length) this.cluster = null;
    const takesArg = shortTakesArg(c);
    if (takesArg === null) return { c: "?", optarg: null, optopt: c };
    if (!takesArg) return { c, optarg: null, optopt: c };
    this.cluster = null;
    if (rest.length > 0) return { c, optarg: rest, optopt: c };
    if (this.optind < this.argv.length) return { c, optarg: this.argv[this.optind++], optopt: c };
    return { c: ":", optarg: null, optopt: c };
  }

  private longOpt(body: string): Opt {
    const eq = body.indexOf("=");
    const name = eq >= 0 ? body.slice(0, eq) : body;
    const inline = eq >= 0 ? body.slice(eq + 1) : null;
    let found = LONG_OPTIONS.find((o) => o.name === name);
    if (!found) {
      const matches = LONG_OPTIONS.filter((o) => o.name.startsWith(name));
      if (matches.length !== 1) return { c: "?", optarg: null, optopt: "\0" };
      found = matches[0];
    }
    if (!found.hasArg) {
      if (inline !== null) return { c: "?", optarg: null, optopt: found.val };
      return { c: found.val, optarg: null, optopt: found.val };
    }
    if (inline !== null) return { c: found.val, optarg: inline, optopt: found.val };
    if (this.optind < this.argv.length) return { c: found.val, optarg: this.argv[this.optind++], optopt: found.val };
    return { c: ":", optarg: null, optopt: found.val };
  }
}

// ---- main() ----------------------------------------------------------------

function fail(message: string): ParseResult {
  return { kind: "error", message, help: false };
}

function failWithHelp(message: string): ParseResult {
  return { kind: "error", message, help: true };
}

export function parseArgs(argv: readonly string[]): ParseResult {
  const conf = defaultConfig();
  let leavesInput = "&";
  let colorsInput = "2,3,10,11";
  const opts = new Getopt(argv);

  for (let opt = opts.next(); opt !== null; opt = opts.next()) {
    const optarg = opt.optarg ?? "";
    switch (opt.c) {
      case "l":
        conf.live = true;
        break;
      case "t": {
        const v = strtod(optarg);
        if (v !== 0 && !Number.isNaN(v)) conf.timeStep = v;
        else return fail(`error: invalid step time: '${optarg}'`);
        if (!(conf.timeStep >= 0) || conf.timeStep === Infinity) return fail(`error: invalid step time: '${optarg}'`);
        break;
      }
      case "i":
        conf.infinite = true;
        break;
      case "w": {
        const v = strtod(optarg);
        if (v !== 0 && !Number.isNaN(v)) conf.timeWait = v;
        else return fail(`error: invalid wait time: '${optarg}'`);
        if (!(conf.timeWait >= 0) || conf.timeWait === Infinity) return fail(`error: invalid wait time: '${optarg}'`);
        break;
      }
      case "S":
        conf.live = true;
        conf.infinite = true;
        conf.save = true;
        conf.load = true;
        conf.screensaver = true;
        break;
      case "m":
        conf.message = optarg;
        break;
      case "b": {
        // Only ERANGE is an error here, so any string is accepted (0 = no base);
        // a literal "inf" is not a range error, an overflowing number is.
        const v = strtod(optarg);
        const literalInf = /^[ \t\n\v\f\r]*[+-]?inf/i.test(optarg);
        if (!Number.isFinite(v) && !Number.isNaN(v) && !literalInf) {
          return fail(`error: invalid base index: '${optarg}'`);
        }
        conf.baseType = toInt(v);
        break;
      }
      case "c":
        leavesInput = optarg.slice(0, 127);
        break;
      case "k":
        colorsInput = optarg.slice(0, 127);
        break;
      case "M": {
        const v = strtod(optarg);
        if (v !== 0 && !Number.isNaN(v)) conf.multiplier = toInt(v);
        else return fail(`error: invalid multiplier: '${optarg}'`);
        if (conf.multiplier < 0) return fail(`error: invalid multiplier: '${optarg}'`);
        break;
      }
      case "L": {
        const v = strtod(optarg);
        if (v !== 0 && !Number.isNaN(v)) conf.lifeStart = toInt(v);
        else return fail(`error: invalid initial life: '${optarg}'`);
        if (conf.lifeStart < 0) return fail(`error: invalid initial life: '${optarg}'`);
        break;
      }
      case "p":
        conf.printTree = true;
        break;
      case "s": {
        const v = strtod(optarg);
        if (v !== 0 && !Number.isNaN(v)) conf.seed = toInt(v);
        else return fail(`error: invalid seed: '${optarg}'`);
        if (conf.seed < 0) return fail(`error: invalid seed: '${optarg}'`);
        break;
      }
      case "W":
        if (optarg.startsWith("-")) opts.optind -= 1;
        else conf.saveFile = optarg;
        conf.save = true;
        break;
      case "C":
        if (optarg.startsWith("-")) opts.optind -= 1;
        else conf.loadFile = optarg;
        conf.load = true;
        break;
      case "v":
        conf.verbosity++;
        break;
      case ":":
        if (opt.optopt === "W") conf.save = true;
        else if (opt.optopt === "C") conf.load = true;
        else return failWithHelp(`error: option requires an argument -- '${opt.optopt}'`);
        break;
      case "?":
        return failWithHelp(`error: invalid option -- '${opt.optopt === "\0" ? "" : opt.optopt}'`);
      case "h":
        return { kind: "help" };
    }
  }

  // strtok(leavesInput, ",") — empty tokens vanish; the array holds 64.
  const leaves = leavesInput.split(",").filter((t) => t.length > 0);
  if (leaves.length === 0) return fail("error: no leaves given");
  conf.leaves = leaves.slice(0, 64);

  const colorTokens = colorsInput.split(",").filter((t) => t.length > 0);
  for (let i = 0; i < 4; i++) {
    const token = colorTokens[i];
    if (token === undefined) return fail("error: too few color indices provided");
    const parsed = strtolExact(token);
    if (parsed === null || parsed < 0 || parsed >= 256) return fail(`error: invalid color index: '${token}'`);
    conf.colors[i] = parsed;
  }
  if (colorTokens.length > 4) return fail("error: too many color indices provided");

  return { kind: "run", config: conf };
}
