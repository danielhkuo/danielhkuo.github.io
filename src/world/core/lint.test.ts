// Source lint for src/world. Deterministic code may only use arithmetic that
// rounds identically in every engine; all world code must run under Node's
// type stripping and the Next bundler alike.

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

/** Paths (relative to src/world) whose arithmetic must be deterministic. */
const DETERMINISTIC = /^(core|gen|bake|pack|sites|look|story)\/|^[^/]+\.ts$/;
const EXEMPT = /^(bench|cli|render|runtime|testing)\//;
/** Paths that only ever run in Node (tools, test helpers): they may import node: modules. */
const NODE_ONLY = /^(cli|testing)\//;

const ARITH: [RegExp, string][] = [
  [
    /\bMath\.(random|sin|cos|tan|pow|exp|expm1|log|log1p|log2|log10|atan2?|asin|acos|sinh|cosh|tanh|asinh|acosh|atanh|cbrt|hypot)\b/,
    "inexact Math",
  ],
  [/\*\*/, "exponent operator"],
  [/\bDate\b/, "Date"],
  [/\bperformance\.now\b/, "clock"],
  [/\.sort\(/, "sort"],
];

const SYNTAX: [RegExp, string][] = [
  [/^\s*(export\s+)?(declare\s+)?(const\s+)?enum\s/m, "enum"],
  [/^\s*(export\s+)?(declare\s+)?namespace\s/m, "namespace"],
  [/from\s+["']@\//, "alias"],
  [/(from|import)\s+["']\.{1,2}\/[^"']*(?<!\.ts)["']/, "import without .ts"],
  [/^\s*@\w+/m, "decorator"],
  [/constructor\s*\([^)]*\b(public|private|protected|readonly)\s/, "parameter property"],
];

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

/** Violations in one file; `path` is relative to src/world. */
export function findViolations(path: string, source: string): string[] {
  if (path.endsWith(".test.ts")) return [];
  const src = stripComments(source);
  const out: string[] = [];
  for (const [re, name] of SYNTAX) if (re.test(src)) out.push(`${path}: ${name}`);
  // Code the browser runs may not lean on Node: Next swaps in slow polyfills (a byte-by-byte Buffer cost 29 ms a frame).
  if (!NODE_ONLY.test(path) && /from\s+["']node:/.test(src)) out.push(`${path}: node import`);
  if (DETERMINISTIC.test(path) && !EXEMPT.test(path)) {
    for (const [re, name] of ARITH) if (re.test(src)) out.push(`${path}: ${name}`);
  }
  return out;
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (p.endsWith(".ts")) acc.push(p);
  }
  return acc;
}

function scanAll(): string[] {
  return walk(ROOT).flatMap((p) => findViolations(relative(ROOT, p).split("\\").join("/"), readFileSync(p, "utf8")));
}

test("the lint catches each banned form", () => {
  const flags = (path: string, src: string) => findViolations(path, src).length > 0;
  for (const call of ["Math.random()", "Math.sin(x)", "Math.pow(a, b)", "Math.atan2(y, x)", "Math.hypot(a, b)", "Math.log(x)"]) {
    assert.ok(flags("gen/x.ts", `const v = ${call};`), call);
  }
  assert.ok(flags("gen/x.ts", "const v = a ** 2;"));
  assert.ok(flags("core/x.ts", "const t = Date.now();"));
  assert.ok(flags("bake/x.ts", "const t = performance.now();"));
  assert.ok(flags("cover.ts", "xs.sort();"));
  assert.ok(flags("runtime/x.ts", "enum Foo { A }"));
  assert.ok(flags("runtime/x.ts", "namespace N {}"));
  assert.ok(flags("cli/x.ts", 'import { a } from "@/lib/a";'));
  assert.ok(flags("cli/x.ts", 'import { a } from "./a";'));
  assert.ok(flags("render/x.ts", "class A { constructor(private a: number) {} }"));
  assert.ok(flags("live/x.ts", 'import { Buffer } from "node:buffer";'));
  assert.ok(!flags("cli/x.ts", 'import { readFileSync } from "node:fs";'));
  // Exempt and allowed forms.
  assert.ok(!flags("bench/x.ts", "const v = Math.sin(x);"));
  assert.ok(!flags("gen/x.ts", "const v = Math.sqrt(Math.abs(x)) + Math.imul(a, b);"));
  assert.ok(!flags("gen/x.ts", "/** Uses **bold** in a comment, and Math.sin in prose. */ const a = 1;"));
  assert.ok(!flags("gen/x.ts", 'import { a } from "./a.ts";'));
  assert.ok(!flags("gen/x.test.ts", "Math.random();"));
});

test("src/world has no violations", () => {
  assert.deepEqual(scanAll(), []);
});
