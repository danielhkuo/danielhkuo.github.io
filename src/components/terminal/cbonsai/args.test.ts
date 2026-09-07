import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_CACHE_PATH, defaultConfig, parseArgs, strtod, strtolExact, toInt } from "./args.ts";

function run(argv: string[]) {
  const r = parseArgs(argv);
  assert.equal(r.kind, "run", JSON.stringify(r));
  return r.kind === "run" ? r.config : defaultConfig();
}

function err(argv: string[]) {
  const r = parseArgs(argv);
  assert.equal(r.kind, "error", JSON.stringify(r));
  return r.kind === "error" ? r : { message: "", help: false };
}

test("no arguments gives the defaults", () => {
  assert.deepEqual(run([]), defaultConfig());
});

test("short flags, clustered and separate", () => {
  const c = run(["-li"]);
  assert.equal(c.live, true);
  assert.equal(c.infinite, true);
  const d = run(["-l", "-p", "-v", "-v"]);
  assert.equal(d.live && d.printTree, true);
  assert.equal(d.verbosity, 2);
});

test("short options with attached and detached values", () => {
  assert.equal(run(["-t0.5"]).timeStep, 0.5);
  assert.equal(run(["-t", "0.5"]).timeStep, 0.5);
  assert.equal(run(["-lt.25"]).timeStep, 0.25);
  assert.equal(run(["-w", "2"]).timeWait, 2);
  assert.equal(run(["-s", "42"]).seed, 42);
  assert.equal(run(["-L", "100"]).lifeStart, 100);
  assert.equal(run(["-M", "7"]).multiplier, 7);
  assert.equal(run(["-b", "2"]).baseType, 2);
  assert.equal(run(["-m", "hello there"]).message, "hello there");
});

test("long options with = and with a separate value, plus prefixes", () => {
  assert.equal(run(["--time=0.1"]).timeStep, 0.1);
  assert.equal(run(["--time", "0.1"]).timeStep, 0.1);
  assert.equal(run(["--liv"]).live, true);
  assert.equal(run(["--inf"]).infinite, true);
  assert.equal(run(["--seed=9"]).seed, 9);
  assert.equal(run(["--message", "hi"]).message, "hi");
});

test("ambiguous or unknown long options are invalid options", () => {
  assert.deepEqual(err(["--l"]), { kind: "error", message: "error: invalid option -- ''", help: true });
  assert.deepEqual(err(["--nope"]), { kind: "error", message: "error: invalid option -- ''", help: true });
  assert.deepEqual(err(["-x"]), { kind: "error", message: "error: invalid option -- 'x'", help: true });
  assert.deepEqual(err(["--live=1"]), { kind: "error", message: "error: invalid option -- 'l'", help: true });
});

test("--print declares a required argument, as in the C source", () => {
  assert.deepEqual(err(["--print"]), {
    kind: "error",
    message: "error: option requires an argument -- 'p'",
    help: true,
  });
  const c = run(["--print", "-l"]);
  assert.equal(c.printTree, true);
  assert.equal(c.live, false);
});

test("missing required arguments", () => {
  assert.equal(err(["-t"]).message, "error: option requires an argument -- 't'");
  assert.equal(err(["-l", "-s"]).message, "error: option requires an argument -- 's'");
});

test("-W and -C without a path keep the default and allow a following option", () => {
  const a = run(["-W"]);
  assert.equal(a.save, true);
  assert.equal(a.saveFile, DEFAULT_CACHE_PATH);
  const b = run(["-W", "-l"]);
  assert.equal(b.save && b.live, true);
  assert.equal(b.saveFile, DEFAULT_CACHE_PATH);
  const c = run(["-C", "mytree", "-l"]);
  assert.equal(c.load && c.live, true);
  assert.equal(c.loadFile, "mytree");
  const d = run(["--save", "--live"]);
  assert.equal(d.save && d.live, true);
});

test("-S enables live, infinite, save, load and screensaver", () => {
  const c = run(["-S"]);
  assert.equal(c.live && c.infinite && c.save && c.load && c.screensaver, true);
});

test("numeric validation copies strtof semantics", () => {
  assert.equal(err(["-t", "0"]).message, "error: invalid step time: '0'");
  assert.equal(err(["-t", "abc"]).message, "error: invalid step time: 'abc'");
  assert.equal(err(["-t", "-1"]).message, "error: invalid step time: '-1'");
  assert.equal(run(["-t", "3abc"]).timeStep, 3);
  assert.equal(err(["-w", "0"]).message, "error: invalid wait time: '0'");
  assert.equal(err(["-M", "0"]).message, "error: invalid multiplier: '0'");
  assert.equal(err(["-M", "-3"]).message, "error: invalid multiplier: '-3'");
  assert.equal(err(["-L", "0"]).message, "error: invalid initial life: '0'");
  assert.equal(err(["-s", "0"]).message, "error: invalid seed: '0'");
  assert.equal(err(["-s", "-5"]).message, "error: invalid seed: '-5'");
  assert.equal(run(["-L", "32.9"]).lifeStart, 32);
  assert.equal(run(["-s", "1e3"]).seed, 1000);
  assert.equal(run(["-s", "0x10"]).seed, 16);
});

test("-b accepts anything that is not a range error", () => {
  assert.equal(run(["-b", "0"]).baseType, 0);
  assert.equal(run(["-b", "abc"]).baseType, 0);
  assert.equal(run(["-b", "2.7"]).baseType, 2);
  assert.equal(err(["-b", "1e99999"]).message, "error: invalid base index: '1e99999'");
});

test("leaves split on commas, empty tokens vanish", () => {
  assert.deepEqual(run(["-c", "&,@,*"]).leaves, ["&", "@", "*"]);
  assert.deepEqual(run(["-c", ",,x,,"]).leaves, ["x"]);
  assert.deepEqual(run(["-c", "木,林"]).leaves, ["木", "林"]);
  assert.equal(err(["-c", ""]).message, "error: no leaves given");
});

test("colours: four indices in 0..255, strtol base 0", () => {
  assert.deepEqual(run(["-k", "1,4,9,12"]).colors, [1, 4, 9, 12]);
  assert.deepEqual(run(["-k", "0x10,010,255,0"]).colors, [16, 8, 255, 0]);
  assert.equal(err(["-k", "1,2,3"]).message, "error: too few color indices provided");
  assert.equal(err(["-k", "1,2,3,4,5"]).message, "error: too many color indices provided");
  assert.equal(err(["-k", "1,2,3,256"]).message, "error: invalid color index: '256'");
  assert.equal(err(["-k", "1,2,3,4x"]).message, "error: invalid color index: '4x'");
  assert.equal(err(["-k", "1,2,3,08"]).message, "error: invalid color index: '08'");
});

test("help wins as soon as it is seen; earlier errors win over it", () => {
  assert.deepEqual(parseArgs(["-h"]), { kind: "help" });
  assert.deepEqual(parseArgs(["-l", "--help", "-t", "0"]), { kind: "help" });
  assert.equal(parseArgs(["-t", "0", "-h"]).kind, "error");
});

test("non-option words are ignored and -- ends options", () => {
  const c = run(["tree", "-l", "--", "-i"]);
  assert.equal(c.live, true);
  assert.equal(c.infinite, false);
});

test("strtod and strtol helpers", () => {
  assert.equal(strtod("  12.5xyz"), 12.5);
  assert.equal(strtod("-.5"), -0.5);
  assert.equal(strtod("0x1p4"), 16);
  assert.equal(strtod("nope"), 0);
  assert.equal(strtod("inf"), Infinity);
  assert.ok(Number.isNaN(strtod("nan")));
  assert.equal(toInt(1e12), -2147483648);
  assert.equal(toInt(-7.9), -7);
  assert.equal(strtolExact("017"), 15);
  assert.equal(strtolExact("0"), 0);
  assert.equal(strtolExact(" 42"), 42);
  assert.equal(strtolExact("42 "), null);
});
