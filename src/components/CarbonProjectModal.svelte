<script lang="ts">
  import { Modal, Button, Tag } from 'carbon-components-svelte';
  import type { CollectionEntry } from 'astro:content';
  import { onMount } from 'svelte';

  export let project: CollectionEntry<'projects'>;
  export let renderedContent: string;
  export let isOpen = false;

  let scrollProgress = 0;

  // Handle modal opening via URL hash
  onMount(() => {
    const handleHashChange = () => {
      const hash = window.location.hash;
      const expectedHash = `#${project.slug}-modal`;
      isOpen = hash === expectedHash;
    };

    // Check initial hash
    handleHashChange();

    // Listen for hash changes and keyboard events
    window.addEventListener('hashchange', handleHashChange);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('hashchange', handleHashChange);
      window.removeEventListener('keydown', handleKeyDown);
    };
  });

  function handleClose() {
    isOpen = false;
    // Clear the hash to close the modal
    if (window.location.hash === `#${project.slug}-modal`) {
      window.history.pushState('', document.title, window.location.pathname + window.location.search);
    }
  }

  function handleKeyDown(event: KeyboardEvent) {
    // Close modal on Escape key
    if (event.key === 'Escape' && isOpen) {
      handleClose();
    }
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
  modalHeading={project.data.title}
  size="lg"
  on:close={handleClose}
  hasScrollingContent={true}
  class="carbon-project-modal"
  passiveModal={true}
>
  <div slot="heading" class="modal-header">
    <!-- Scroll Progress Indicator -->
    <div class="scroll-progress">
      <div class="scroll-progress-bar" style="width: {scrollProgress}%"></div>
    </div>
  </div>

  <div class="modal-content" on:scroll={handleScroll}>
    <!-- Project Header Section - Carbon Tile Style -->
    <div class="project-tile">
      <div class="project-tile-content">
        <div class="project-title-section">
          {#if project.data.emoji}
            <span class="project-emoji">{project.data.emoji}</span>
          {/if}
          <h1 class="project-title cds--type-productive-heading-04">{project.data.title}</h1>
        </div>
        
        <p class="project-description cds--type-body-long-01">{project.data.description}</p>
        
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
          
          <Button
            href={project.data.repoUrl}
            target="_blank"
            rel="noopener noreferrer"
            kind="tertiary"
            size="small"
            class="repo-button"
          >
            <svg slot="icon" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
            </svg>
            View Repository
          </Button>
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
  :global(.carbon-project-modal .cds--modal-container) {
    max-width: 1100px;
    width: 100%;
    height: 90vh;
    max-height: 90vh;
  }

  :global(.carbon-project-modal .cds--modal-content) {
    padding: 0;
    height: 100%;
    display: flex;
    flex-direction: column;
  }

  :global(.carbon-project-modal .cds--modal-header) {
    position: relative;
    padding: var(--cds-spacing-05);
    border-bottom: 1px solid var(--cds-border-subtle);
  }

  .modal-header {
    position: relative;
    width: 100%;
  }

  .scroll-progress {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 4px;
    background: var(--cds-layer-accent);
    overflow: hidden;
  }

  .scroll-progress-bar {
    height: 100%;
    background: linear-gradient(90deg, var(--cds-interactive), var(--cds-focus));
    transition: width 0.1s ease;
    position: relative;
  }

  .scroll-progress-bar::after {
    content: '';
    position: absolute;
    top: 0;
    right: -10px;
    width: 10px;
    height: 100%;
    background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.3));
    animation: shimmer 2s infinite;
  }

  @keyframes shimmer {
    0%, 100% { opacity: 0; }
    50% { opacity: 1; }
  }

  .modal-content {
    flex: 1;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    scroll-behavior: smooth;
    padding: var(--cds-spacing-05);
  }

  /* Carbon Tile-inspired project header */
  .project-tile {
    background-color: var(--cds-layer);
    border: 1px solid var(--cds-border-subtle);
    border-radius: var(--cds-border-radius, 0.5rem);
    margin-bottom: var(--cds-spacing-06);
    box-shadow: var(--cds-shadow);
    transition: all var(--cds-productive-standard, 0.15s) cubic-bezier(0.2, 0, 0.38, 0.9);
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

  :global(.repo-button) {
    align-self: flex-start;
    margin-top: var(--cds-spacing-02);
  }

  :global(.repo-button svg) {
    width: 16px;
    height: 16px;
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
    font-family: 'IBM Plex Mono', 'Menlo', 'Monaco', 'Consolas', 'Liberation Mono', 'Courier New', monospace;
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

  /* Custom Scrollbar for Webkit browsers */
  .modal-content::-webkit-scrollbar {
    width: 12px;
  }

  .modal-content::-webkit-scrollbar-track {
    background: var(--cds-layer);
    border-radius: 6px;
    margin: 10px 0;
  }

  .modal-content::-webkit-scrollbar-thumb {
    background: linear-gradient(180deg, var(--cds-interactive), var(--cds-focus));
    border-radius: 6px;
    border: 2px solid var(--cds-layer);
    transition: all 0.3s ease;
  }

  .modal-content::-webkit-scrollbar-thumb:hover {
    background: linear-gradient(180deg, var(--cds-focus), var(--cds-interactive));
    transform: scale(1.1);
    box-shadow: 0 0 10px rgba(var(--cds-interactive-rgb, 0, 123, 255), 0.3);
  }

  /* Responsive Design */
  @media (max-width: 640px) {
    :global(.carbon-project-modal .cds--modal-container) {
      width: 100vw;
      height: 100vh;
      max-height: 100vh;
      border-radius: 0;
      margin: 0;
      max-width: none;
    }

    :global(.carbon-project-modal .cds--modal-content) {
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