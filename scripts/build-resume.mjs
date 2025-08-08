// scripts/build-resume.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import pdf from 'pdf-parse';

/**
 * Shape we’ll generate. Tweak as needed.
 * {
 *   name: string,
 *   title?: string,
 *   contact: { email?: string, phone?: string, location?: string, links?: string[] },
 *   sections: [{ heading: string, items: string[] }],
 *   skills?: string[]
 * }
 */

const INPUT = path.resolve('public/resume/Daniel-Kuo-Resume.pdf');
const OUTPUT_DIR = path.resolve('src/content');
const OUTPUT = path.join(OUTPUT_DIR, 'resume.json');

function normalize(text) {
  // normalize bullets and whitespace a bit
  return text
    .replace(/\u2022|\u2023|\u25E6|\u2043|\u2219/g, '•')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseResume(text) {
  const txt = normalize(text);
  const lines = txt.split('\n').map(l => l.trim()).filter(Boolean);

  // Header assumptions for a fixed template (adjust to your format)
  const firstSectionIdx = lines.findIndex(l =>
    /^(Education|Experience|Projects|Skills|Awards|Leadership|Activities)\b/i.test(l)
  );
  const headerLines = firstSectionIdx > 0 ? lines.slice(0, firstSectionIdx) : lines.slice(0, 3);

  const name = headerLines[0] || 'Daniel Kuo';
  const title = headerLines[1] && !/@/.test(headerLines[1]) ? headerLines[1] : undefined;

  const email = txt.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
  const phone = txt.match(/(\+?\d[\d ()-]{7,}\d)/)?.[0];
  const location = txt.match(/\b([A-Z][a-z]+(?:\s|,))+[A-Z]{2}\b/)?.[0];
  const links = Array.from(new Set(
    [...txt.matchAll(/\bhttps?:\/\/[^\s)]+/gi)].map(m => m[0])
  ));

  // Split into sections on headings you actually use
  const parts = txt.split(/\n(?=(Education|Experience|Projects|Skills|Awards|Leadership|Activities)\b)/i).filter(Boolean);
  const sections = [];
  let skills = [];

  // parts like: [heading, body, heading, body, ...]
  for (let i = 0; i < parts.length; i += 2) {
    const heading = parts[i].trim();
    const body = (parts[i + 1] || '').trim();

    if (!heading) continue;
    if (/^Skills$/i.test(heading)) {
      // skills as comma or newline separated
      skills = body
        .split(/[,•\n]/)
        .map(s => s.replace(/^[•\-–]\s?/, '').trim())
        .filter(Boolean);
      continue;
    }

    const items = body
      .split(/\n(?=(?:[•\-–]\s|[A-Z][^\n]{0,40}\s—|•|-\s|\d+\.\s))/) // crude bullet/sentence split
      .map(s => s.replace(/^[•\-–]\s?/, '').trim())
      .map(s => s.replace(/\s{2,}/g, ' '))
      .filter(Boolean);

    sections.push({ heading, items });
  }

  return {
    name,
    title,
    contact: { email, phone, location, links },
    sections,
    ...(skills.length ? { skills } : {})
  };
}

async function main() {
  try {
    const buf = await fs.readFile(INPUT);
    const data = await pdf(buf);
    const resume = parseResume(data.text || '');
    await fs.mkdir(OUTPUT_DIR, { recursive: true });
    await fs.writeFile(OUTPUT, JSON.stringify(resume, null, 2), 'utf8');
    console.log('✓ Generated', path.relative(process.cwd(), OUTPUT));
  } catch (err) {
    console.error('Failed to build resume JSON:', err.message);
    process.exitCode = 1;
  }
}

main();
