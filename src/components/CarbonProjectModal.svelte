<script lang="ts">
  import { Modal, Tag } from "carbon-components-svelte";
  import type { CollectionEntry } from "astro:content";
  import { onMount, tick } from "svelte"; // FIX: Import tick

  export let project: CollectionEntry<"projects">;
  export let renderedContent: string;
  export let isOpen = false;

  let scrollProgress = 0;

  const MODAL_SEL = ".cds--modal, .bx--modal";
  const CONTAINER_SEL = ".cds--modal-container, .bx--modal-container";

  async function syncModalTheme() {
    if (typeof document === "undefined") return;
    await tick();
    const modal = document.querySelector(MODAL_SEL) as HTMLElement | null;
    const container = document.querySelector(
      CONTAINER_SEL
    ) as HTMLElement | null;
    if (!modal || !container) return;
    const currentTheme =
      document.documentElement.getAttribute("data-carbon-theme") || "g100";
    [modal, container].forEach((el) =>
      el.setAttribute("data-carbon-theme", currentTheme)
    );
    const computed = getComputedStyle(document.documentElement);
    // copy all Carbon vars
    for (const name of Array.from(computed)) {
      if (name.startsWith("--cds-")) {
        const value = computed.getPropertyValue(name);
        modal.style.setProperty(name, value);
        container.style.setProperty(name, value);
      }
    }
  }

  // Keep the modal synced whenever it opens
  $: if (isOpen) {
    syncModalTheme();
  }

  // Handle modal opening via URL hash
  onMount(() => {
    const handleHashChange = () => {
      const hash = window.location.hash;
      const expectedHash = `#${project.slug}-modal`;
      isOpen = hash === expectedHash;
    };

    // Check initial hash
    handleHashChange();

    // Listen for hash changes, keyboard events, and theme changes
    window.addEventListener("hashchange", handleHashChange);
    window.addEventListener("keydown", handleKeyDown);

    // Listen for theme attribute changes
    const observer = new MutationObserver((m) => {
      if (
        m.some(
          (x) =>
            x.type === "attributes" && x.attributeName === "data-carbon-theme"
        )
      ) {
        if (isOpen) syncModalTheme();
      }
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-carbon-theme"],
    });

    return () => {
      window.removeEventListener("hashchange", handleHashChange);
      window.removeEventListener("keydown", handleKeyDown);
      observer.disconnect();
    };
  });

  function handleClose() {
    isOpen = false;
    // Clear the hash to close the modal
    if (window.location.hash === `#${project.slug}-modal`) {
      window.history.pushState(
        "",
        document.title,
        window.location.pathname + window.location.search
      );
    }
  }

  function handleKeyDown(event: KeyboardEvent) {
    // Close modal on Escape key
    if (event.key === "Escape" && isOpen) {
      handleClose();
    }
  }

  function handleRepoClick() {
    window.open(project.data.repoUrl, "_blank", "noopener,noreferrer");
  }

  function handleScroll(event: Event) {
    const target = event.target as HTMLElement;
    const scrollTop = target.scrollTop;
    const scrollHeight = target.scrollHeight - target.clientHeight;
    scrollProgress = scrollHeight > 0 ? (scrollTop / scrollHeight) * 100 : 0;
  }
</script>

<Modal
  bind:open={isOpen}
  size="lg"
  on:close={handleClose}
  hasScrollingContent={true}
  passiveModal={true}
  class="carbon-project-modal"
  primaryButtonText="Close"
  secondaryButtonText="View Repository"
  on:submit={handleClose}
  on:click:button--secondary={handleRepoClick}
>
  <h3 slot="heading" class="modal-heading-with-progress">
    <a
      href={project.data.repoUrl}
      target="_blank"
      rel="noopener noreferrer"
      on:click|stopPropagation
      class="heading-link"
    >
      {project.data.title}
    </a>

    <!-- Always-visible progress in header -->
    <div class="header-progress" aria-hidden="true">
      <div class="header-progress-bar" style="width: {scrollProgress}%"></div>
    </div>
    <span class="visually-hidden" role="status" aria-live="polite">
      {Math.round(scrollProgress)}% scrolled
    </span>
  </h3>
  <div class="modal-content" on:scroll={handleScroll}>
    <!-- Project Header Section - Carbon Tile Style -->
    <div class="project-tile">
      <div class="project-tile-content">
        <div class="project-title-section">
          {#if project.data.emoji}
            <span class="project-emoji">{project.data.emoji}</span>
          {/if}
          <h1 class="project-title cds--type-productive-heading-04">
            {project.data.title}
          </h1>
        </div>

        <p class="project-description cds--type-body-long-01">
          {project.data.description}
        </p>

        <hr class="project-divider" />

        <div class="project-footer">
          <div class="tech-stack">
            <span class="tech-label cds--type-body-short-01">
              <strong>Stack:</strong>
            </span>
            <div class="tech-tags">
              {#each project.data.tech as tech}
                <Tag type="outline" size="sm">{tech}</Tag>
              {/each}
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Project Content -->
    <article class="prose">
      {@html renderedContent}
    </article>
  </div>
</Modal>

<style>
  /* FIX: Target the modal container directly WITHOUT the wrapper class. */
  /* This ensures our custom layout overrides apply. */
  :global(.cds--modal-container) {
    max-width: 1100px;
    width: 100%;
    height: 90vh;
    max-height: 90vh;
    /* Note: We no longer need to force background-color here, as the programmatic theme injection will handle it correctly via Carbon's own styles. */
  }

  /* Let Carbon control the backdrop via --cds-overlay */

  /* Border styling for modal container */
  :global(:where(.cds--modal-container, .bx--modal-container)) {
    border: 1px solid var(--cds-border-subtle);
  }

  /* FIX: Ensure the close button icon inherits the correct theme color. */
  :global(.cds--modal-close .cds--modal-close__icon) {
    fill: var(--cds-icon-primary);
  }

  :global(.cds--modal-content) {
    padding: 0;
    height: 100%;
    display: flex;
    flex-direction: column;
  }

  :global(.cds--modal-header) {
    position: relative;
    padding: var(--cds-spacing-05);
    border-bottom: 1px solid var(--cds-border-subtle);
  }

  /* Wrap heading + progress for easier control */
  .modal-heading-with-progress {
    position: relative;
    margin: 0;
    padding-bottom: calc(
      var(--cds-spacing-05) - 4px
    ); /* make space for the bar */
    font-size: var(--cds-productive-heading-04-font-size);
    font-weight: var(--cds-productive-heading-04-font-weight);
    line-height: var(--cds-productive-heading-04-line-height);
  }

  .modal-heading-with-progress .heading-link {
    color: var(--cds-text-primary);
    text-decoration: none;
    transition: color var(--cds-productive-standard, 0.15s) ease;
  }

  .modal-heading-with-progress .heading-link:hover {
    color: var(--cds-link-primary);
    text-decoration: underline;
  }

  .modal-heading-with-progress .heading-link:focus {
    outline: 2px solid var(--cds-focus);
    outline-offset: 2px;
  }

  .header-progress {
    position: absolute;
    left: 0;
    right: 0;
    bottom: -1px; /* sit on top of the header's bottom border */
    height: 4px;
    background: var(--cds-layer-accent);
    overflow: hidden;
    pointer-events: none; /* don't block header clicks */
    z-index: 1;
  }

  .header-progress-bar {
    height: 100%;
    background: linear-gradient(
      90deg,
      var(--cds-interactive),
      var(--cds-focus)
    );
    transition: width 0.1s ease;
  }

  /* a11y helper */
  .visually-hidden {
    position: absolute !important;
    clip: rect(1px, 1px, 1px, 1px);
    clip-path: inset(50%);
    height: 1px;
    overflow: hidden;
    white-space: nowrap;
    width: 1px;
  }

  .modal-content {
    position: relative;
    flex: 1;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    scroll-behavior: smooth;
    padding: var(--cds-spacing-05);

    /* Hide scrollbar, keep scrollability */
    scrollbar-width: none; /* Firefox */
    -ms-overflow-style: none; /* IE/Edge legacy */
  }

  /* Carbon Tile-inspired project header */
  .project-tile {
    background-color: var(--cds-layer);
    border: 1px solid var(--cds-border-subtle);
    border-radius: var(--cds-border-radius, 0.5rem);
    margin-top: var(--cds-spacing-04);
    margin-bottom: var(--cds-spacing-06);
    box-shadow: var(--cds-shadow);
    transition: all var(--cds-productive-standard, 0.15s)
      cubic-bezier(0.2, 0, 0.38, 0.9);
    position: relative;
    overflow: hidden;
  }

  .project-tile:hover {
    box-shadow: var(--cds-shadow-raised);
  }

  .project-tile-content {
    padding: var(--cds-spacing-05);
    height: 100%;
    display: flex;
    flex-direction: column;
  }

  .project-title-section {
    display: flex;
    align-items: center;
    gap: var(--cds-spacing-03);
    margin-bottom: var(--cds-spacing-03);
  }

  .project-emoji {
    font-size: 1.5rem;
    line-height: 1;
    flex-shrink: 0;
  }

  .project-title {
    color: var(--cds-text-primary);
    margin: 0;
    flex: 1;
  }

  .project-description {
    color: var(--cds-text-secondary);
    margin-bottom: var(--cds-spacing-04);
    flex-grow: 1;
  }

  .project-divider {
    border: none;
    border-top: 1px solid var(--cds-border-subtle);
    margin: var(--cds-spacing-03) 0;
    opacity: 0.5;
  }

  .project-footer {
    margin-top: auto;
    padding-top: var(--cds-spacing-03);
    display: flex;
    flex-direction: column;
    gap: var(--cds-spacing-04);
  }

  .tech-stack {
    display: flex;
    flex-direction: column;
    gap: var(--cds-spacing-03);
  }

  .tech-label {
    color: var(--cds-text-secondary);
  }

  .tech-label strong {
    font-weight: var(--cds-font-weight-semibold);
    color: var(--cds-text-primary);
  }

  .tech-tags {
    display: flex;
    flex-wrap: wrap;
    gap: var(--cds-spacing-02);
  }

  .prose {
    max-width: none;
    color: var(--cds-text-primary);
    line-height: var(--cds-body-long-02-line-height);
  }

  .prose :global(h1) {
    color: var(--cds-text-primary);
    font-size: var(--cds-productive-heading-04-font-size);
    font-weight: var(--cds-productive-heading-04-font-weight);
    line-height: var(--cds-productive-heading-04-line-height);
    margin-bottom: var(--cds-spacing-05);
  }

  .prose :global(h2) {
    color: var(--cds-text-primary);
    font-size: var(--cds-productive-heading-03-font-size);
    font-weight: var(--cds-productive-heading-03-font-weight);
    line-height: var(--cds-productive-heading-03-line-height);
    margin-bottom: var(--cds-spacing-04);
    margin-top: var(--cds-spacing-06);
  }

  .prose :global(h3) {
    color: var(--cds-text-primary);
    font-size: var(--cds-productive-heading-02-font-size);
    font-weight: var(--cds-productive-heading-02-font-weight);
    line-height: var(--cds-productive-heading-02-line-height);
    margin-bottom: var(--cds-spacing-03);
    margin-top: var(--cds-spacing-05);
  }

  .prose :global(p) {
    color: var(--cds-text-primary);
    font-size: var(--cds-body-long-01-font-size);
    font-weight: var(--cds-body-long-01-font-weight);
    line-height: var(--cds-body-long-01-line-height);
    margin-bottom: var(--cds-spacing-04);
  }

  .prose :global(strong) {
    font-weight: var(--cds-font-weight-semibold, 600) !important;
    color: var(--cds-text-primary) !important;
  }

  .prose :global(b) {
    font-weight: var(--cds-font-weight-semibold, 600) !important;
    color: var(--cds-text-primary) !important;
  }

  .prose :global(em) {
    font-style: italic;
  }

  .prose :global(ul) {
    list-style-type: disc;
    margin-left: var(--cds-spacing-05);
    margin-bottom: var(--cds-spacing-04);
  }

  .prose :global(ol) {
    list-style-type: decimal;
    margin-left: var(--cds-spacing-05);
    margin-bottom: var(--cds-spacing-04);
  }

  .prose :global(li) {
    margin-bottom: var(--cds-spacing-02);
    color: var(--cds-text-primary);
  }

  .prose :global(code) {
    background-color: var(--cds-layer-accent);
    color: var(--cds-text-primary);
    padding: 0.125rem 0.25rem;
    border-radius: 0.25rem;
    font-family: "IBM Plex Mono", "Menlo", "Monaco", "Consolas",
      "Liberation Mono", "Courier New", monospace;
    font-size: 0.875em;
  }

  .prose :global(pre) {
    background-color: var(--cds-layer-accent);
    color: var(--cds-text-primary);
    padding: var(--cds-spacing-04);
    border-radius: var(--cds-border-radius);
    overflow-x: auto;
    margin-bottom: var(--cds-spacing-04);
  }

  .prose :global(pre code) {
    background: none;
    padding: 0;
  }

  /* Hide scrollbar for WebKit/Chromium */
  .modal-content::-webkit-scrollbar {
    width: 0;
    height: 0;
  }

  /* Responsive Design */
  @media (max-width: 640px) {
    :global(.cds--modal-container) {
      width: 100vw;
      height: 100vh;
      max-height: 100vh;
      border-radius: 0;
      margin: 0;
      max-width: none;
    }

    :global(.cds--modal-content) {
      height: 100vh;
      border-radius: 0;
    }

    .modal-content {
      padding: var(--cds-spacing-04);
    }

    .project-tile {
      margin-bottom: var(--cds-spacing-05);
      border-radius: 0;
      border-left: none;
      border-right: none;
    }

    .project-tile-content {
      padding: var(--cds-spacing-04);
    }

    .project-title-section {
      flex-direction: column;
      align-items: flex-start;
      gap: var(--cds-spacing-02);
    }

    .project-emoji {
      font-size: 1.25rem;
    }

    .project-title {
      font-size: var(--cds-productive-heading-03-font-size);
    }

    .project-footer {
      gap: var(--cds-spacing-03);
    }

    .tech-stack {
      gap: var(--cds-spacing-02);
    }
  }

  /* Enhanced focus states for accessibility */
  .modal-content:focus {
    outline: 2px solid var(--cds-focus);
    outline-offset: -2px;
  }
</style>
