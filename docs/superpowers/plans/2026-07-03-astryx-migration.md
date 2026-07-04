# Astryx Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the bespoke "kami/parchment" design with the Astryx design system + chocolate theme, keeping the terminal's Apple-terminal look and the manual light/dark toggle.

**Architecture:** Import Astryx's pre-built CSS (reset + core + chocolate theme) for SSR/SSG safety. A client `AstryxThemeProvider` wraps the app in `<Theme theme={chocolateTheme} mode={...}>`; a rewritten `lib/theme.ts` drives Astryx's attribute-based mode instead of the old `.dark` class. Every non-terminal component is rebuilt on Astryx primitives (Card/VStack/HStack/Grid/Heading/Text/Button/Field/TextInput/TextArea/Badge). Tailwind v4 stays as a thin override layer backed by Astryx tokens. The terminal keeps its dark monospace look with reconciled tokens.

**Tech Stack:** Next.js 16 (static export), React 19, `@astryxdesign/core` 0.1.2, `@astryxdesign/theme-chocolate`, `@astryxdesign/cli`, Tailwind v4, `next/font/google` (Fraunces + Albert Sans).

## Global Constraints

- Node/Next: Next.js 16.1.6, React 19.2.3, `output: "export"` static export must keep succeeding.
- Astryx rule: no `<div>` / raw HTML for **layout** in migrated components; use Astryx layout primitives. No `style={{}}` for styling decisions. Exceptions: (a) data-driven values from the GitHub API such as a language's `color` hex and a percentage `width` are allowed inline (they are data, not design choices); (b) the terminal subsystem, which stays bespoke.
- No raw hex/px for design values in new code; use Astryx tokens or Tailwind utilities backed by tokens. Never override `--color-*` in `:root`.
- Astryx CLI: invoke as `node node_modules/@astryxdesign/cli/bin/astryx.mjs <cmd>` (a `npm run astryx --` script is added in Task 1). Discover component props with `astryx component <Name>` before use.
- Astryx mode is attribute-driven: theme CSS keys off unqualified `[data-astryx-media="light"|"dark"]` and `[data-astryx-theme="chocolate"]`; there is **no** `prefers-color-scheme` fallback. Mode values are `'light' | 'dark' | 'system'`.
- Preserve verbatim (logic only, restyle wrappers): web3forms submit + hCaptcha (`ContactForm`), GitHub fetch (`lib/github.ts`), scroll-spy `IntersectionObserver` (`HoverMenu`), `useSyncExternalStore` pattern (`lib/theme.ts`, `LiveTime`), SSG data flow and section ids (`#about`, `#work`, `#contact`) in `page.tsx`.
- Terminal (`src/components/terminal/*` and the decorative "$ whoami" hero panel) stays a dark, monospace, Apple-terminal aesthetic. No structural rewrite.
- Verification model: this is a UI migration with no unit-test harness. Each task's gate is: `npm run build` passes (TypeScript + static export), `npm run lint` passes, and a visual check in the running dev app in **both** light and dark. Final task also runs `npm run a11y` and `npm run contrast`.

---

## File Structure

- `package.json` — add `astryx` script; Astryx deps already installed.
- `src/app/layout.tsx` — mount `AstryxThemeProvider`, load fonts, replace the `.dark` pre-paint script with a `data-astryx-media` one.
- `src/app/globals.css` — swap token blocks for Astryx CSS imports + tailwind-theme; keep terminal "ink" tokens.
- `src/app/fonts.ts` (new) — `next/font/google` for Fraunces + Albert Sans.
- `src/components/AstryxThemeProvider.tsx` (new, client) — wraps children in `<Theme>`, owns mode state.
- `src/lib/theme.ts` — rewrite to drive Astryx mode via `data-astryx-media` + localStorage.
- `src/app/page.tsx` — rebuild layout on Astryx primitives.
- `src/components/Masthead.tsx`, `HoverMenu.tsx`, `ProjectCard.tsx`, `ContactForm.tsx`, `LiveTime.tsx`, `CopyButton.tsx`, `LocationMap.tsx`, `terminal/ShellHint.tsx` — migrate to Astryx.
- `src/components/terminal/Terminal.tsx`, `TerminalLauncher.tsx` — token reconcile only.

Each task ends with an independently reviewable, buildable deliverable. `globals.css` is pruned **last** (Task 11) so old utility classes keep working while components migrate one at a time.

---

## Task 1: Setup — deps, CLI script, Astryx CSS imports

**Files:**
- Modify: `package.json` (scripts)
- Modify: `src/app/globals.css:1`

**Interfaces:**
- Produces: global Astryx styles loaded (`reset.css`, `astryx.css`, chocolate `theme.css`, `tailwind-theme.css`); `npm run astryx -- <cmd>` available.

- [ ] **Step 1: Confirm deps are installed**

Run: `node -e "require.resolve('@astryxdesign/core/astryx.css'); require.resolve('@astryxdesign/theme-chocolate/theme.css'); console.log('ok')"`
Expected: `ok`. If it fails: `npm install @astryxdesign/core @astryxdesign/theme-chocolate && npm install -D @astryxdesign/cli`.

- [ ] **Step 2: Add the `astryx` script**

In `package.json` `"scripts"`, add:

```json
"astryx": "node node_modules/@astryxdesign/cli/bin/astryx.mjs"
```

- [ ] **Step 3: Import Astryx CSS at the top of `globals.css`**

`src/app/globals.css` currently starts with `@import "tailwindcss";`. Replace that first line with (order matters — reset first, then core, then theme, then tailwind + token bridge):

```css
@import "@astryxdesign/core/reset.css";
@import "@astryxdesign/core/astryx.css";
@import "@astryxdesign/theme-chocolate/theme.css";
@import "tailwindcss";
@import "@astryxdesign/core/tailwind-theme.css";
```

Leave the rest of `globals.css` untouched for now (old tokens still back the not-yet-migrated components).

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: build succeeds, `out/` regenerated. (The site will look partly restyled/mixed — that is expected mid-migration.)

- [ ] **Step 5: Commit**

```bash
git add package.json src/app/globals.css
git commit -m "chore: install Astryx, add CLI script, import core + chocolate CSS"
```

---

## Task 2: Fonts — Fraunces + Albert Sans

**Files:**
- Create: `src/app/fonts.ts`
- Modify: `src/app/layout.tsx`

**Interfaces:**
- Produces: `fraunces` and `albertSans` `next/font` objects exporting `.variable` CSS variables `--font-fraunces` and `--font-albert-sans`, applied to `<body>`.

- [ ] **Step 1: Create the font module**

`src/app/fonts.ts`:

```ts
import { Fraunces, Albert_Sans } from "next/font/google";

export const fraunces = Fraunces({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-fraunces",
});

export const albertSans = Albert_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-albert-sans",
});
```

- [ ] **Step 2: Apply the font variables on `<body>`**

In `src/app/layout.tsx`, import the fonts and add their `.variable` classes to `<body>` (keep `antialiased`):

```tsx
import { fraunces, albertSans } from "./fonts";
// ...
<body className={`${fraunces.variable} ${albertSans.variable} antialiased`}>
```

- [ ] **Step 3: Point the chocolate theme's font tokens at the loaded fonts**

Append to the **bottom** of `src/app/globals.css` (these are font-family bridges, not `--color-*` overrides, so they are allowed):

```css
:root {
  --font-family-display: var(--font-fraunces), Georgia, serif;
  --font-family-body: var(--font-albert-sans), system-ui, sans-serif;
}
```

Then run `npm run astryx -- docs typography` and confirm the token names Astryx uses for display/body font families; if they differ from the above, use the names it reports.

- [ ] **Step 4: Verify build + fonts load**

Run: `npm run build` (expect success), then `npm run dev` and load the page; confirm no console errors and that headings/body render in the new fonts (Task 4 onward makes this visually obvious).

- [ ] **Step 5: Commit**

```bash
git add src/app/fonts.ts src/app/layout.tsx src/app/globals.css
git commit -m "feat: load Fraunces + Albert Sans for the chocolate theme"
```

---

## Task 3: Theme provider + mode wiring + no-flash

**Files:**
- Create: `src/components/AstryxThemeProvider.tsx`
- Rewrite: `src/lib/theme.ts`
- Modify: `src/app/layout.tsx`

**Interfaces:**
- Consumes: `chocolateTheme` from `@astryxdesign/theme-chocolate/built`, `Theme` from `@astryxdesign/core`.
- Produces (from `lib/theme.ts`, keeping the existing public API so `HoverMenu`, `ContactForm`, terminal `theme` command keep working):
  - `type ThemeMode = "dark" | "light"` (the resolved concrete mode)
  - `getTheme(): ThemeMode`
  - `setTheme(mode: ThemeMode | "toggle"): ThemeMode`
  - `useThemeMode(): ThemeMode`
  - `onThemeChange(cb): () => void`
- Produces: `<AstryxThemeProvider>{children}</AstryxThemeProvider>` wrapping the app in layout.

**Design note (the no-flash mechanism):** Astryx's theme CSS uses the **unqualified** selector `[data-astryx-media="dark"]`, so setting `data-astryx-media="dark"` on `<html>` flips the whole palette before paint. `lib/theme.ts` writes this attribute on `<html>` + persists to `localStorage`; the pre-paint inline script does the same before first paint; `<Theme mode>` manages the same concept on its own wrapper post-hydration. Because the provider defaults to `mode="system"` on both server and first client render, there is no hydration mismatch on the wrapper; the `<html>` attribute is set by the script/`theme.ts` (and `<html>` already has `suppressHydrationWarning`).

- [ ] **Step 1: Rewrite `src/lib/theme.ts`**

Keep the same exported names/signatures, but drive `data-astryx-media` instead of the `.dark` class:

```ts
import { useSyncExternalStore } from "react";

export type ThemeMode = "dark" | "light";

const STORAGE_KEY = "theme";
const ATTR = "data-astryx-media";
export const THEME_EVENT = "themechange";

function systemPref(): ThemeMode {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function getTheme(): ThemeMode {
  if (typeof document === "undefined") return "light";
  const attr = document.documentElement.getAttribute(ATTR);
  return attr === "dark" ? "dark" : "light";
}

export function applyTheme(mode: ThemeMode): ThemeMode {
  if (typeof document === "undefined") return mode;
  document.documentElement.setAttribute(ATTR, mode);
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* private mode / storage disabled — theme still applies for this session */
  }
  window.dispatchEvent(new CustomEvent<ThemeMode>(THEME_EVENT, { detail: mode }));
  return mode;
}

export function setTheme(mode: ThemeMode | "toggle"): ThemeMode {
  const next = mode === "toggle" ? (getTheme() === "dark" ? "light" : "dark") : mode;
  return applyTheme(next);
}

export function onThemeChange(cb: (mode: ThemeMode) => void): () => void {
  const handler = (e: Event) => cb((e as CustomEvent<ThemeMode>).detail);
  window.addEventListener(THEME_EVENT, handler);
  return () => window.removeEventListener(THEME_EVENT, handler);
}

const subscribeTheme = (notify: () => void) => onThemeChange(() => notify());
const getServerTheme = (): ThemeMode => "light";

export function useThemeMode(): ThemeMode {
  return useSyncExternalStore(subscribeTheme, getTheme, getServerTheme);
}

/** Read the persisted concrete mode (localStorage, else OS). Client-only. */
export function readStoredMode(): ThemeMode {
  if (typeof window === "undefined") return "light";
  try {
    const t = localStorage.getItem(STORAGE_KEY);
    if (t === "dark" || t === "light") return t;
  } catch {
    /* ignore */
  }
  return systemPref();
}
```

- [ ] **Step 2: Create `AstryxThemeProvider`**

`src/components/AstryxThemeProvider.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { Theme } from "@astryxdesign/core";
import { chocolateTheme } from "@astryxdesign/theme-chocolate/built";
import { readStoredMode, onThemeChange, type ThemeMode } from "@/lib/theme";

export default function AstryxThemeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  // 'system' on server + first client render → no hydration mismatch.
  const [mode, setMode] = useState<ThemeMode | "system">("system");

  useEffect(() => {
    // After mount, adopt the persisted/OS concrete mode and keep in sync with
    // the nav/terminal toggle (which call setTheme in lib/theme.ts).
    setMode(readStoredMode());
    return onThemeChange((m) => setMode(m));
  }, []);

  return (
    <Theme theme={chocolateTheme} mode={mode}>
      {children}
    </Theme>
  );
}
```

Before writing, run `npm run astryx -- component Theme` to confirm the `theme`/`mode` prop names and that `@astryxdesign/theme-chocolate/built` exports `chocolateTheme` (README/docs; adjust the import name if the CLI reports otherwise).

- [ ] **Step 3: Wire the provider + no-flash script into `layout.tsx`**

Replace the old `.dark` pre-paint script with one that sets `data-astryx-media` on `<html>`, and wrap `children` in the provider:

```tsx
import AstryxThemeProvider from "@/components/AstryxThemeProvider";
// ...
<head>
  <script
    dangerouslySetInnerHTML={{
      __html: `try{var t=localStorage.getItem('theme');var d=t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme:dark)').matches);document.documentElement.setAttribute('data-astryx-media',d?'dark':'light')}catch(e){}`,
    }}
  />
  {/* keep the existing preconnect/dns-prefetch links */}
</head>
<body className={`${fraunces.variable} ${albertSans.variable} antialiased`}>
  <AstryxThemeProvider>{children}</AstryxThemeProvider>
</body>
```

Keep `suppressHydrationWarning` on `<html>`.

- [ ] **Step 4: Verify no-flash + toggle empirically**

Run `npm run dev`. Then:
- In the running app, run in the browser console: `document.documentElement.setAttribute('data-astryx-media','dark')` and confirm the palette flips to dark chocolate. Set it back to `'light'` and confirm it returns. (This proves the unqualified selector reaches `<html>`.)
- Set `localStorage.theme='dark'`, hard-reload, and confirm the page paints dark immediately with no light flash.
- Confirm `npm run build` still succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/lib/theme.ts src/components/AstryxThemeProvider.tsx src/app/layout.tsx
git commit -m "feat: drive light/dark via Astryx Theme + data-astryx-media, no-flash"
```

---

## Task 4: Page shell — `page.tsx` on Astryx primitives

**Files:**
- Modify: `src/app/page.tsx`

**Interfaces:**
- Consumes: existing child components (unchanged this task) and `fetchPinnedRepos()`.
- Produces: page structure using `VStack`/`Grid`/`Card` etc.; preserves section ids `#about`, `#work`, `#contact`, the SSG `fetchPinnedRepos()` call, and the `terminalProjects` slice passed to `TerminalLauncher`.

- [ ] **Step 1: Discover the primitives**

Run `npm run astryx -- component VStack`, `... HStack`, `... Grid`, `... Card`, `... Heading`, `... Text`, `... Divider` and note props. Key facts: `VStack`/`HStack` take numeric `gap` (0,0.5,1,1.5,2,3,4,5,6,8,10) and `hAlign`/`vAlign`; `Grid` takes `columns` (number or `{minWidth,max,repeat}`) and `gap`; `Card` takes numeric `padding` and `variant`; `Heading` needs `level` (+ optional `type="display-1|2|3"`); `Text` takes `type`.

- [ ] **Step 2: Rebuild the page body**

Rewrite `page.tsx` keeping the same sections and data flow. Use Tailwind only for the outer max-width centering (kept as the override layer); use Astryx primitives for everything inside. Skeleton (fill each section using the components migrated in later tasks; `Masthead`, `ProjectCard`, `ContactForm`, `LocationMap`, etc. are still their old versions this task and render fine):

```tsx
import HoverMenu from "@/components/HoverMenu";
import Masthead from "@/components/Masthead";
import ProjectCard from "@/components/ProjectCard";
import { VStack, Heading, Text } from "@astryxdesign/core";
// ...dynamic imports for LocationMap + ContactForm unchanged...

export default async function Home() {
  const projects = await fetchPinnedRepos();
  const terminalProjects = projects.map((p) => ({
    name: p.name, description: p.description, url: p.url, homepageUrl: p.homepageUrl,
  }));

  return (
    <VStack gap={0}>
      <HoverMenu />
      <Masthead />
      <main className="mx-auto w-full max-w-6xl px-5 sm:px-8 lg:px-10">
        <VStack gap={0}>
          <section id="about" className="scroll-mt-28">{/* about content (Task 9 keeps the terminal panel) */}</section>
          <section id="currently">{/* LocationMap + LiveTime/CopyButton column */}</section>
          <section id="work" className="scroll-mt-28">
            <Heading level={2} type="display-2">Pinned repositories from GitHub.</Heading>
            <VStack gap={6}>
              {projects.length > 0
                ? projects.map((p) => <ProjectCard key={p.name} project={p} />)
                : <Text type="body">No pinned repositories found. Add a GITHUB_TOKEN to fetch real projects.</Text>}
            </VStack>
          </section>
          <section id="contact" className="scroll-mt-28">{/* ContactForm */}</section>
        </VStack>
      </main>
      {/* footer via HStack + Text; TerminalLauncher unchanged */}
      <TerminalLauncher projects={terminalProjects} />
    </VStack>
  );
}
```

Keep the exact heading copy currently on the page ("Pinned repositories from GitHub.", "Send a note.", the "$ whoami" content). Do not delete the terminal hero panel markup in `#about` — leave it as-is for Task 9. Replace outer `<div>` wrappers and section grids with Astryx primitives; keep `<section>` elements (they carry the ids and are semantic landmarks, not layout `<div>`s) and `<main>`.

- [ ] **Step 3: Verify**

Run `npm run build` (expect success) and `npm run dev`; confirm the page renders, section anchors still scroll, and the terminal still opens. Check light and dark.

- [ ] **Step 4: Commit**

```bash
git add src/app/page.tsx
git commit -m "refactor: rebuild page shell on Astryx layout primitives"
```

---

## Task 5: Masthead (hero)

**Files:**
- Modify: `src/components/Masthead.tsx`

**Interfaces:**
- Produces: hero using `Card` + `Grid` + `Heading`/`Text` + `Button`/link, headshot via `next/image` (grayscale/sepia treatment preserved as a data/visual effect on the image element).

- [ ] **Step 1: Discover** — `npm run astryx -- component Button` and `... component Card` and `... component Badge` (tags "Rice CS"/"Houston"/"Goldman Sachs AWM" → `Badge`). Note `Button` requires `label`, supports `variant`/`size`/`icon`, and renders text from `label`. For links styled as buttons, render an `<a>` and use `Button`'s intended pattern from `astryx docs` (or wrap a `Button` with an anchor via its documented link support).

- [ ] **Step 2: Rebuild**

Replace the `paper-panel`/`div` structure with:
- Outer `Card` (padding via prop) containing a `Grid columns={{minWidth: 320, max: 2}}` (image column + text column).
- Image column: keep `next/image` with `fill`, `sizes`, `priority`, and the existing grayscale/contrast/sepia `style` filter (image treatment = allowed).
- Text column: `VStack` with an `HStack gap` of three `Badge` tags, then `Heading level={1} type="display-1"` for "Full-stack product builder & team architect.", a `Text type="large"` intro, and a footer `HStack` with a "Resume" secondary button (links to `/Daniel-Kuo-Resume.pdf`) and an "Email" primary button (`mailto:danielhkuo@rice.edu`).

Preserve all current copy verbatim.

- [ ] **Step 3: Verify** — `npm run build`, `npm run dev`; hero renders in chocolate, Resume/Email links work, light + dark checked.

- [ ] **Step 4: Commit**

```bash
git add src/components/Masthead.tsx
git commit -m "refactor: rebuild Masthead hero on Astryx components"
```

---

## Task 6: HoverMenu (floating nav)

**Files:**
- Modify: `src/components/HoverMenu.tsx`

**Interfaces:**
- Consumes: `setTheme`, `useThemeMode` from `@/lib/theme`.
- Produces: floating pill nav; **keeps** the `IntersectionObserver` scroll-spy, the `terminal:open` CustomEvent dispatch (with `data-terminal-trigger` + `aria-haspopup="dialog"`), and the theme toggle.

- [ ] **Step 1: Discover** — `npm run astryx -- component Button`, `... component IconButton`, `... docs icons` (for terminal/sun/moon semantic icons; if none fit, keep the existing inline SVG icon components — allowed as icon data).

- [ ] **Step 2: Rebuild the inner controls**

Keep the outer fixed-position wrapper (`fixed inset-x-0 top-4 z-50 px-4` — positioning utilities, allowed) and the scroll-spy `useEffect` exactly as-is. Replace the inner capsule contents:
- Terminal launcher: a `Button` (or `IconButton`) that keeps `onClick={openTerminal}`, `data-terminal-trigger=""`, `aria-haspopup="dialog"`.
- Nav links (`#about`/`#work`/`#contact`): render `<a>`s; style the active one with an Astryx `Button variant="primary"` look and inactive as `ghost`, or use tokened Tailwind utilities. Keep the `active` state logic.
- Theme toggle: an `IconButton` calling `setTheme("toggle")`, swapping Sun/Moon by `useThemeMode()`, with the existing `aria-label` logic.
- Email link: a `Button`/link to `mailto:danielhkuo@rice.edu`.

- [ ] **Step 3: Verify** — `npm run build`, `npm run dev`; scroll-spy highlights the active section, terminal opens from the nav, toggle flips light/dark and persists. Check both modes.

- [ ] **Step 4: Commit**

```bash
git add src/components/HoverMenu.tsx
git commit -m "refactor: rebuild HoverMenu controls on Astryx, keep scroll-spy + toggle"
```

---

## Task 7: ProjectCard

**Files:**
- Modify: `src/components/ProjectCard.tsx`

**Interfaces:**
- Consumes: `PinnedRepo` from `@/lib/github` (unchanged).
- Produces: card using `Card` + `Grid` + `Heading`/`Text` + `Badge` + `Button`; language-mix bars keep per-language colors from the API.

- [ ] **Step 1: Discover** — `npm run astryx -- component Card`, `... component Badge`, `... component Meter`, `... component Divider`.

- [ ] **Step 2: Rebuild**

- Outer `Card` replacing `article.paper-panel`.
- `Grid columns={{minWidth: 320, max: 2}}` for the two columns.
- Left column: meta `Badge`s ("Updated …", primary language with its color dot), `Heading level={3}` wrapping the repo link (`<a>` to `project.url`), `Text` description, and a footer `HStack` of Stars/Forks `Badge`s + "Repository ↗" (`<a>` styled as secondary `Button`) + optional "Live ↗" primary link.
- Right column ("Language mix"): for each significant language, render the name (with its `color` dot) + `percentage`, and a thin bar. Use a minimal bar whose `width` = `${percentage}%` and `backgroundColor` = `lang.color` (both are API data, allowed inline); the track uses a tokened background. (Astryx `Meter` is single-accent and can't carry per-language colors, so a data-driven bar is intentional here.)

Preserve the primary-language color dot, the `>1%` filter, and the empty-state text.

- [ ] **Step 3: Verify** — `npm run build`, `npm run dev`; cards render, language bars show correct widths/colors, links work, both modes checked.

- [ ] **Step 4: Commit**

```bash
git add src/components/ProjectCard.tsx
git commit -m "refactor: rebuild ProjectCard on Astryx, keep API-driven language bars"
```

---

## Task 8: ContactForm (controlled rewrite)

**Files:**
- Modify: `src/components/ContactForm.tsx`

**Interfaces:**
- Consumes: `useThemeMode` (for hCaptcha `theme`), `TextInput`/`TextArea`/`Button` from Astryx.
- Produces: a controlled form that builds the web3forms JSON payload from component state (Astryx inputs have no `name` attribute, so `FormData` no longer applies).

**Design note:** `TextInput`/`TextArea` are controlled (`value` + `onChange(value, e)` required) and expose no `name`. Move name/email/message into `useState`, validate in JS, and assemble the payload object directly. Keep the access key, subject, hCaptcha, and the exact fetch to `https://api.web3forms.com/submit`.

- [ ] **Step 1: Discover** — `npm run astryx -- component TextInput`, `... component TextArea`, `... component Button`, `... component Field`.

- [ ] **Step 2: Rewrite as controlled**

- Add `const [name,setName]=useState(""); const [email,setEmail]=useState(""); const [message,setMessage]=useState("");`
- Replace the three `<input>/<textarea>` with `TextInput label="Name"` (type text), `TextInput label="Email" type="email"`, `TextArea label="Message" rows={6}`, each wired to its state via `value`/`onChange`. Keep placeholders.
- In `handleSubmit`, keep the captcha guard; validate required fields + a basic email check in JS (replacing `form.checkValidity()`), then build:

```ts
const payload = {
  access_key: "166051ec-a006-47dd-abec-9be280b7432f",
  subject: "New Contact Form Submission",
  name, email, message,
  "h-captcha-response": captchaToken,
};
const response = await fetch("https://api.web3forms.com/submit", {
  method: "POST",
  headers: { "Content-Type": "application/json", Accept: "application/json" },
  body: JSON.stringify(payload),
});
```

- On success, clear the three state fields (instead of `form.reset()`), reset captcha, and keep the 5s message clear.
- Submit `Button type="submit" label={isSubmitting ? "Sending..." : "Send Message"}` with `isDisabled={isSubmitting || !captchaToken}` (or `isLoading={isSubmitting}`).
- Keep `<HCaptcha ref theme={theme} sitekey="50b2fe65-b00b-4b9e-ad62-3ba471098be2" reCaptchaCompat={false} onVerify={onCaptchaChange} />` and the `role="status"` result text.

- [ ] **Step 3: Verify** — `npm run build`, `npm run dev`; the form renders in chocolate, captcha shows, empty-field validation blocks submit, and (optionally, if a live key is desired) a real submission succeeds. Both modes checked; confirm hCaptcha theme follows the toggle.

- [ ] **Step 4: Commit**

```bash
git add src/components/ContactForm.tsx
git commit -m "refactor: rebuild ContactForm as controlled Astryx form"
```

---

## Task 9: Small components — LiveTime, CopyButton, LocationMap, ShellHint

**Files:**
- Modify: `src/components/LiveTime.tsx`, `src/components/CopyButton.tsx`, `src/components/LocationMap.tsx`, `src/components/terminal/ShellHint.tsx`

**Interfaces:**
- Produces: same component APIs and logic; wrappers restyled with Astryx `Text`/`Button`/`Card` and tokens.

- [ ] **Step 1:** For each, keep all logic (timers, clipboard, map tiles, hint text). Replace styling wrappers: `LiveTime` → `Text`/`Badge`; `CopyButton`/`CopyableText` → `Button`/`IconButton` (keep the copy + "Copied" feedback and `useSyncExternalStore`-free clipboard logic); `LocationMap` → keep the map/tiles, wrap chrome in `Card`/tokens; `ShellHint` → `Text` with the mono terminal styling (it belongs to the terminal panel — keep it monospace/dark-panel styled).

- [ ] **Step 2: Verify** — `npm run build`, `npm run dev`; live clock ticks, copy works and shows feedback, map renders, both modes checked.

- [ ] **Step 3: Commit**

```bash
git add src/components/LiveTime.tsx src/components/CopyButton.tsx src/components/LocationMap.tsx src/components/terminal/ShellHint.tsx
git commit -m "refactor: restyle small components with Astryx tokens/components"
```

---

## Task 10: Terminal token reconcile

**Files:**
- Modify: `src/components/terminal/Terminal.tsx`, `src/components/terminal/TerminalLauncher.tsx`, and the "$ whoami" hero panel markup in `src/app/page.tsx` (`#about`)

**Interfaces:**
- Produces: terminal keeps its dark Apple-terminal look (monospace, traffic-light dots, ink background) in both light and dark site modes; only token references reconciled so it coexists with chocolate.

- [ ] **Step 1:** Confirm the terminal still relies on the `--panel-ink*` / `--panel-on` / `--panel-accent` tokens (these are preserved in Task 11's cleanup). Where the terminal referenced now-removed bespoke tokens (e.g. `--danger`/`--warn`/`--success` for the traffic-light dots, `--tracking-label`), replace them with the retained ink tokens or fixed terminal-local values so the terminal renders identically regardless of site mode. Keep the monospace font stack.

- [ ] **Step 2: Verify** — `npm run build`, `npm run dev`; open the terminal (Cmd/Ctrl+K and nav), run `help`, `theme`, tab-completion, history; confirm it looks like the current Apple terminal in **both** site light and dark modes and the "$ whoami" hero panel is unchanged.

- [ ] **Step 3: Commit**

```bash
git add src/components/terminal/Terminal.tsx src/components/terminal/TerminalLauncher.tsx src/app/page.tsx
git commit -m "refactor: reconcile terminal tokens, keep Apple-terminal look"
```

---

## Task 11: Cleanup globals.css + dead-class audit + final verification

**Files:**
- Modify: `src/app/globals.css`

**Interfaces:**
- Produces: slim `globals.css` — Astryx CSS imports (Task 1) + Tailwind + tailwind-theme + font-family bridges (Task 2) + terminal ink tokens + minimal resets. Bespoke token blocks and unused utility classes removed.

- [ ] **Step 1: Audit for stragglers**

Run:
```bash
grep -rnE 'paper-panel|capsule-shell|kami-tag|caps-label|font-display|font-caps|font-body|--accent|--fg-2|--tracking-|--tag-bg-|bg-bg|text-text-|border-divider' src/ | grep -v 'globals.css'
```
Every hit is a not-yet-migrated reference. Migrate or replace each (to an Astryx token/component or a tailwind-theme utility) until only intended references remain. Terminal files keeping `--panel-*` are expected.

- [ ] **Step 2: Prune `globals.css`**

Remove the bespoke `:root` token block (colors, spacing/radius/type scales, Tailwind/legacy aliases) and `html.dark` overrides that Astryx now supplies. **Keep**: the Astryx imports, `@import "tailwindcss"`, the tailwind-theme import, the font-family bridge from Task 2, the `--panel-ink` / `--panel-ink-2` / `--panel-on` / `--panel-accent` terminal tokens, and any custom class still used by the terminal. Remove now-dead utility classes (`.paper-panel`, `.capsule-shell`, `.kami-tag`, `.caps-label`, etc.) once Step 1 is clean.

- [ ] **Step 3: Full verification**

Run in order, all must pass:
```bash
npm run lint
npm run build
npm run contrast
npm run a11y
```
Then `npm run dev` and do a visual pass of every section in **light and dark**: masthead, about/terminal, currently (map + clock + copy), work (project cards + language bars), contact (form + captcha), footer, and the interactive terminal. Confirm: no theme flash on load, toggle works from nav and terminal, no console errors, static `out/` builds.

- [ ] **Step 4: Commit**

```bash
git add src/app/globals.css
git commit -m "chore: prune bespoke tokens/classes, keep terminal ink tokens"
```

---

## Self-Review

**Spec coverage:**
- Chocolate theme adoption → Tasks 1, 3, 4–9. ✓
- Terminal keeps Apple look → Tasks 4 (panel left intact), 10. ✓
- Manual toggle wired to Astryx mode, default system, no flash → Task 3. ✓
- Tailwind kept as override layer → Tasks 1 (tailwind-theme import), used throughout for positioning/max-width. ✓
- Fonts (Fraunces + Albert Sans) → Task 2. ✓
- globals.css pruned, ink tokens kept → Task 11. ✓
- Static-export-safe wiring (pre-built CSS + no-flash) → Tasks 1, 3. ✓
- Preserve web3forms/hCaptcha, GitHub fetch, scroll-spy, SSG/section ids → Tasks 8, 6, 4. ✓
- Success criteria (build/lint/a11y/contrast, both modes, no div/inline-style/raw-hex/`--color-*`) → Task 11 + per-task gates + Global Constraints. ✓

**Placeholder scan:** Component-prop discovery steps (`astryx component X`) are intentional (the system's "discover, don't guess" rule), each paired with concrete best-known code — not TODO placeholders. No "TBD"/"handle edge cases"/"similar to Task N" left.

**Type consistency:** `lib/theme.ts` public API (`getTheme`/`setTheme`/`useThemeMode`/`onThemeChange`/`ThemeMode`) is unchanged from today's usage in `HoverMenu`/`ContactForm`/terminal; new `readStoredMode` is defined in Task 3 and consumed only by `AstryxThemeProvider` (same task). `data-astryx-media` attribute name is used consistently in `theme.ts` and the layout script.
