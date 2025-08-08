<script lang="ts">
  import { Modal, Tag } from "carbon-components-svelte";
  import { onMount, tick } from "svelte";
  // @ts-ignore – Vite will inline JSON
  import resumeData from "../content/resume.json";

  type Section = { heading: string; items: string[] };
  type Entry = { title?: string; subtitle?: string; bullets: string[] };
  type Resume = {
    name: string;
    title?: string;
    contact: { email?: string; phone?: string; location?: string; links?: string[] };
    sections: Section[];
    skills?: string[];
  };

  let resume: Resume = resumeData;
  export let isOpen = false;
  let scrollProgress = 0;

  const MODAL_SEL = ".cds--modal, .bx--modal";
  const CONTAINER_SEL = ".cds--modal-container, .bx--modal-container";

  async function syncModalTheme() {
    if (typeof document === "undefined") return;
    await tick();
    const modal = document.querySelector(MODAL_SEL) as HTMLElement | null;
    const container = document.querySelector(CONTAINER_SEL) as HTMLElement | null;
    if (!modal || !container) return;

    const theme = document.documentElement.getAttribute("data-carbon-theme") || "g100";
    [modal, container].forEach((el) => el.setAttribute("data-carbon-theme", theme));
    const computed = getComputedStyle(document.documentElement);
    for (const name of Array.from(computed)) {
      if (name.startsWith("--cds-")) {
        const value = computed.getPropertyValue(name);
        modal.style.setProperty(name, value);
        container.style.setProperty(name, value);
      }
    }
  }
  $: if (isOpen) syncModalTheme();

  function handleHashChange() { isOpen = window.location.hash === "#resume-modal"; }
  function handleClose() {
    isOpen = false;
    if (window.location.hash === "#resume-modal") {
      history.replaceState("", document.title, location.pathname + location.search);
    }
  }
  function handleKeyDown(e: KeyboardEvent) { if (e.key === "Escape" && isOpen) handleClose(); }
  function handleScroll(e: Event) {
    const t = e.target as HTMLElement; const h = t.scrollHeight - t.clientHeight;
    scrollProgress = h > 0 ? (t.scrollTop / h) * 100 : 0;
  }
  onMount(() => {
    handleHashChange();
    window.addEventListener("hashchange", handleHashChange);
    window.addEventListener("keydown", handleKeyDown);
    const obs = new MutationObserver(m => {
      if (m.some(x => x.type === "attributes" && x.attributeName === "data-carbon-theme")) {
        if (isOpen) syncModalTheme();
      }
    });
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-carbon-theme"] });
    return () => { window.removeEventListener("hashchange", handleHashChange); window.removeEventListener("keydown", handleKeyDown); obs.disconnect(); };
  });

  // ---------- Formatting & grouping helpers ----------
  const CITY_ST = /\b([A-Z][a-z]+(?:\s[A-Z][a-z]+)*)\,\s([A-Z]{2})\b/;
  const DATE_RANGE =
    /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t|tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{4}\b(?:\s*[–—-]\s*(?:Present|Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t|tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{4})?/g;

  function looksLikeHeader(s: string): boolean {
    // Company/School line (with City, ST) OR a concise line with tech/title separators or clear date ranges
    return CITY_ST.test(s) || / \| /.test(s) || (!!s.match(DATE_RANGE) && !/:\s/.test(s) && s.length < 120);
  }
  function looksLikeSubtitle(s: string): boolean {
    // Role + dates line, or a second line that contains dates/teams
    return !!s.match(DATE_RANGE) || /Intern|Engineer|Lead|Developer|Co-?founder|Team|Manager|Bachelor|Master/i.test(s);
  }

  function groupSection(sec: Section): Entry[] {
    const entries: Entry[] = [];
    let cur: Entry = { bullets: [] };

    for (const raw of sec.items) {
      const s = raw.trim();
      if (!s) continue;

      if (looksLikeHeader(s)) {
        if (cur.title || cur.subtitle || cur.bullets.length) entries.push(cur);
        cur = { title: s, subtitle: undefined, bullets: [] };
        continue;
      }
      if (!cur.subtitle && looksLikeSubtitle(s)) {
        cur.subtitle = s;
        continue;
      }
      cur.bullets.push(s);
    }
    if (cur.title || cur.subtitle || cur.bullets.length) entries.push(cur);
    return entries;
  }

  function emphasizeTitle(line: string): string {
    // Bold before " | ", or before City, ST, else bold first comma chunk.
    if (line.includes(" | ")) {
      const [l, r] = line.split(" | ", 2);
      return `<strong>${l}</strong> <span class="muted">|</span> ${r}`;
    }
    const m = line.match(CITY_ST);
    if (m) {
      const idx = line.indexOf(m[0]);
      return `<strong>${line.slice(0, idx).trim()}</strong> <span class="muted">${line.slice(idx)}</span>`;
    }
    const c = line.indexOf(",");
    if (c > 0 && c < 60) return `<strong>${line.slice(0, c)}</strong>${line.slice(c)}`;
    return `<strong>${line}</strong>`;
  }

  function boldLabels(text: string): string {
    // Bold "Something:" labels (Relevant Coursework:, Languages:, etc.)
    return text.replace(/^([\w .&/()+\-]+:)\s*/u, (_, lbl) => `<strong>${lbl}</strong> `);
  }
  function highlightDates(text: string): string {
    return text.replace(DATE_RANGE, (m) => `<span class="date-chip">${m}</span>`);
  }
  function fmt(text: string): string {
    return highlightDates(boldLabels(text));
  }
</script>

<Modal
  bind:open={isOpen}
  size="lg"
  passiveModal={true}
  on:close={handleClose}
  class="carbon-resume-modal"
>
  <h3 slot="heading" class="modal-heading-with-progress">
    {resume?.name}{resume?.title ? ` — ${resume.title}` : ''}
    <div class="header-progress" aria-hidden="true">
      <div class="header-progress-bar" style="width: {scrollProgress}%"></div>
    </div>
    <span class="visually-hidden" role="status" aria-live="polite">
      {Math.round(scrollProgress)}% scrolled
    </span>
  </h3>

  <div class="modal-content" on:scroll={handleScroll}>
    {#if resume}
      <!-- Contact & skills -->
      <section class="summary">
        <div class="summary-grid cds--type-body-short-01">
          {#if resume.contact.email}<div><strong>Email:</strong> {resume.contact.email}</div>{/if}
          {#if resume.contact.phone}<div><strong>Phone:</strong> {resume.contact.phone}</div>{/if}
          {#if resume.contact.location}<div><strong>Location:</strong> {resume.contact.location}</div>{/if}
          {#if resume.contact.links?.length}
            <div class="links"><strong>Links:</strong>
              {#each resume.contact.links as link}
                <a href={link} target="_blank" rel="noopener noreferrer">{link}</a>
              {/each}
            </div>
          {/if}
        </div>
        {#if resume.skills?.length}
          <div class="skills">
            {#each resume.skills as s}
              <Tag type="outline" size="sm">{s}</Tag>
            {/each}
          </div>
        {/if}
      </section>

      {#each resume.sections as sec}
        <section class="resume-section">
          <h4 class="section-title cds--type-productive-heading-02">{sec.heading}</h4>

          <!-- Grouped entries -->
          {#each groupSection(sec) as entry}
            <article class="entry">
              {#if entry.title}
                <div class="entry-title">{@html emphasizeTitle(entry.title)}</div>
              {/if}
              {#if entry.subtitle}
                <div class="entry-subtitle">{@html fmt(entry.subtitle)}</div>
              {/if}

              {#if entry.bullets.length}
                <ul class="resume-bullets">
                  {#each entry.bullets as b}
                    <li>{@html fmt(b)}</li>
                  {/each}
                </ul>
              {/if}
            </article>
          {/each}
        </section>
      {/each}
    {/if}
  </div>
</Modal>

<style>
  :global(.cds--modal-container){ max-width: 1100px; width:100%; height: 90vh; max-height: 90vh; }
  :global(.cds--modal-content){ padding:0; height:100%; display:flex; flex-direction:column; }
  :global(.cds--modal-header){ position:relative; padding: var(--cds-spacing-05); border-bottom: 1px solid var(--cds-border-subtle); }

  .modal-heading-with-progress { position:relative; margin:0; padding-bottom: calc(var(--cds-spacing-05) - 4px); }
  .header-progress { position:absolute; left:0; right:0; bottom:-1px; height:4px; background: var(--cds-layer-accent); overflow:hidden; }
  .header-progress-bar { height:100%; background: linear-gradient(90deg, var(--cds-interactive), var(--cds-focus)); transition: width .1s ease; }
  .visually-hidden { position:absolute!important; clip:rect(1px,1px,1px,1px); clip-path: inset(50%); height:1px; overflow:hidden; white-space:nowrap; width:1px; }

  .modal-content { position:relative; flex:1; overflow-y:auto; -webkit-overflow-scrolling:touch; scroll-behavior:smooth; padding: var(--cds-spacing-05); }
  .summary { margin-bottom: var(--cds-spacing-05); }
  .summary-grid { display:grid; gap:.25rem; margin-bottom:.5rem; }
  .summary .links a { margin-right:.5rem; }
  .skills { display:flex; flex-wrap:wrap; gap:.25rem; margin:.25rem 0 1rem; }

  .resume-section { margin-top: var(--cds-spacing-06); }
  .section-title { margin: 0 0 var(--cds-spacing-03) 0; }

  .entry {
    border-left: 3px solid var(--cds-interactive);
    padding-left: var(--cds-spacing-04);
    margin: var(--cds-spacing-04) 0 var(--cds-spacing-05);
  }

  .entry-title {
    font-weight: 600;
    margin-bottom: .125rem;
  }
  .entry-title .muted { color: var(--cds-text-secondary); }

  .entry-subtitle {
    color: var(--cds-text-secondary);
    margin-bottom: .5rem;
  }

  .date-chip {
    display: inline-block;
    padding: .125rem .375rem;
    border-radius: .375rem;
    background: var(--cds-layer-accent);
    color: var(--cds-text-primary);
    font-size: .85em;
    margin-left: .25rem;
    white-space: nowrap;
  }

  .resume-bullets {
    list-style: disc outside;
    margin: 0 0 0 1.25rem;
    padding: 0;
  }
  .resume-bullets li {
    margin: .35rem 0;
    line-height: 1.5;
  }
  .resume-bullets li::marker {
    color: var(--cds-interactive);
  }

  /* Links + text balance */
  a { color: var(--cds-link-primary); text-decoration: none; }
  a:hover { text-decoration: underline; }
</style>
