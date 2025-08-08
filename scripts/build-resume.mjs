#!/usr/bin/env bun
/* eslint-env node */
/* eslint no-console: "off" */

import fs from "node:fs/promises";
import path from "node:path";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

const INPUT = path.resolve("public/resume/Daniel-Kuo-Resume.pdf");
const OUTPUT_DIR = path.resolve("src/content");
const OUTPUT = path.join(OUTPUT_DIR, "resume.json");

const HEADINGS = [
  "Education",
  "Experience",
  "Projects",
  "Technical Skills",
  "Skills",
  "Awards",
  "Leadership",
  "Activities",
];

const US_STATES = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","DC","DE","FL","GA","HI","IA","ID","IL","IN","KS",
  "KY","LA","MA","MD","ME","MI","MN","MO","MS","MT","NC","ND","NE","NH","NJ","NM","NV",
  "NY","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VA","VT","WA","WI","WV","WY",
]);

function normalize(str) {
  return str
    .replace(/\u2022|\u2023|\u25E6|\u2043|\u2219/g, "•") // normalize bullets
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\s+–\s+/g, " — ") // normalize en dash around dates
    .trim();
}

// Group PDF.js text items into lines by Y (with tolerance), sort lines top→bottom and items left→right.
async function extractTextByLines(buffer) {
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buffer), disableWorker: true });
  const pdf = await loadingTask.promise;

  const pageLines = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();

    // Bucket items into lines using Y proximity
    const lines = []; // [{ y: number, items: [{x,str,width}] }]
    const Y_TOL = 2.5; // pixels tolerance for same line
    for (const it of content.items) {
      // pdfjs gives transform: [a,b,c,d,e,f]; e≈x, f≈y
      // @ts-ignore
      const [,, , , x, y] = it.transform;
      const str = String(it.str ?? "").replace(/\s+/g, " ");
      if (!str) continue;

      let line = lines.find(l => Math.abs(l.y - y) <= Y_TOL);
      if (!line) {
        line = { y, items: [] };
        lines.push(line);
      }
      line.items.push({ x, str, w: it.width ?? 0 });
    }

    // Sort lines top→bottom (pdf coords: bigger y = higher on page), then items left→right
    lines.sort((a, b) => b.y - a.y);
    for (const ln of lines) ln.items.sort((a, b) => a.x - b.x);

    // Join items, insert spaces on gaps
    const GAP = 1.0;
    const textLines = lines.map(ln => {
      let out = "";
      let prevEnd = null;
      for (const it of ln.items) {
        if (prevEnd !== null && it.x - prevEnd > GAP) out += " ";
        out += it.str;
        prevEnd = it.x + it.w;
      }
      return normalize(out);
    });

    // Push non-empty lines, add page break
    for (const t of textLines) if (t) pageLines.push(t);
    pageLines.push(""); // blank line as page break
  }

  // Dedup consecutive identical lines (some PDFs duplicate running header)
  const dedup = [];
  for (const t of pageLines) {
    if (dedup.length === 0 || dedup[dedup.length - 1] !== t) dedup.push(t);
  }
  return dedup;
}

// Try to pull a City, ST only (avoid false "IT" endings)
function pickUSCityState(lines) {
  const re = /\b([A-Z][a-z]+(?:\s[A-Z][a-z]+)*)\,\s([A-Z]{2})\b/;
  for (const line of lines) {
    const m = line.match(re);
    if (m && US_STATES.has(m[2])) return `${m[1]}, ${m[2]}`;
  }
  return undefined;
}

function parseHeader(lines) {
  // First non-empty line should be name + maybe contact string
  const nonEmpty = lines.filter(Boolean);
  const top = nonEmpty.slice(0, 4); // search near top
  const headerLine = top[0] || "";
  const name = headerLine.split(/[|•]/)[0].trim() || "Daniel Kuo";

  const email = nonEmpty.join(" ").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
  const phone = nonEmpty.join(" ").match(/(\+?\d[\d ()-]{7,}\d)/)?.[0];
  const links = Array.from(new Set(
    [...nonEmpty.join(" ").matchAll(/\bhttps?:\/\/[^\s)]+/gi)].map(m => m[0])
  ));

  // Prefer a City, ST near top; otherwise any City, ST anywhere
  const location = pickUSCityState(top) || pickUSCityState(nonEmpty);

  return { name, email, phone, links, location };
}

function splitIntoSections(lines) {
  const sections = [];
  let current = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    const isHeading = HEADINGS.some(h => line.toLowerCase() === h.toLowerCase());
    if (isHeading) {
      if (current) sections.push(current);
      current = { heading: HEADINGS.find(h => h.toLowerCase() === line.toLowerCase()), body: [] };
      continue;
    }
    if (!current) continue; // skip any pre-heading noise
    current.body.push(line);
  }
  if (current) sections.push(current);
  return sections;
}

function bodyToItems(sec) {
  // If bullets exist, use them. Otherwise split heuristically on sentence/role boundaries.
  const joined = sec.body.join("\n");

  if (/•/.test(joined)) {
    return joined
      .split(/\n+/)
      .flatMap(l => l.split(/(?=•)/)) // keep bullets as item heads
      .map(s => s.replace(/^•\s?/, "").trim())
      .filter(Boolean);
  }

  // No bullets: split on strong separators (em dash, " - ", numbered points)
  return joined
    .split(/\n(?=[A-Z])|(?<=\.)\s+(?=[A-Z])|(?:^|\n)\d+\.\s+/)
    .map(s => s.replace(/^\d+\.\s+/, "").trim())
    .filter(Boolean);
}

function parseSkillsBlock(lines) {
  // Expect lines like: "Languages: Java, Python, …"
  const text = lines.join(" ");
  const fields = {};
  const parts = text.split(/\s{2,}|(?<=:)\s*/); // loose split
  // Fallback: aggressively split on "Xyz:" keys
  const matches = text.matchAll(/([A-Za-z &/]+):\s*([^:]+)(?=\s+[A-Za-z &/]+:|$)/g);
  for (const m of matches) {
    const key = m[1].trim();
    const vals = m[2].split(/[,•]\s*/).map(s => s.trim()).filter(Boolean);
    if (key && vals.length) fields[key] = vals;
  }
  // Also provide a flat list
  const flat = Object.values(fields).flat();
  return { categories: fields, list: Array.from(new Set(flat)) };
}

function parseResumeFromLines(lines) {
  // Header
  const header = parseHeader(lines);

  // Remove the very top header line from body (it often repeats)
  const firstHeadingIdx = lines.findIndex(l => HEADINGS.some(h => l.trim().toLowerCase() === h.toLowerCase()));
  const bodyLines = firstHeadingIdx >= 0 ? lines.slice(firstHeadingIdx) : lines;

  // Sections
  const rawSections = splitIntoSections(bodyLines);

  const sections = [];
  let skillsFlat = [];

  for (const sec of rawSections) {
    if (/^technical skills$|^skills$/i.test(sec.heading)) {
      const parsed = parseSkillsBlock(sec.body);
      skillsFlat = parsed.list;
      sections.push({
        heading: "Technical Skills",
        items: Object.entries(parsed.categories).map(([k, arr]) => `${k}: ${arr.join(", ")}`),
      });
    } else {
      const items = bodyToItems(sec);
      sections.push({ heading: sec.heading, items });
    }
  }

  return {
    name: header.name,
    title: undefined,
    contact: {
      email: header.email,
      phone: header.phone,
      location: header.location,
      links: header.links,
    },
    sections,
    ...(skillsFlat.length ? { skills: skillsFlat } : {}),
  };
}

(async () => {
  try {
    const buf = await fs.readFile(INPUT);
    const lines = await extractTextByLines(buf);
    const resume = parseResumeFromLines(lines);

    await fs.mkdir(OUTPUT_DIR, { recursive: true });
    await fs.writeFile(OUTPUT, JSON.stringify(resume, null, 2), "utf8");
    console.log("✓ Generated", path.relative(process.cwd(), OUTPUT));
  } catch (err) {
    console.error("Failed to build resume JSON:", err);
    process.exitCode = 1;
  }
})();