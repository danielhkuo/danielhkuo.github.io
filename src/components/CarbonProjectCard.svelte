<script lang="ts">
  export let title: string;
  export let description: string;
  export let tech: string[];
  export let repoUrl: string;
  export let slug: string;



  function handleClick(event: MouseEvent) {
    // Open modal on both desktop and mobile
    event.preventDefault();
    const modalId = `#${slug}-modal`;
    window.location.hash = modalId;
  }

  function handleRepoClick(event: MouseEvent) {
    // Prevent the tile click event from firing when clicking the repo link
    event.stopPropagation();
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleClick(event as any);
    }
  }
</script>

<div 
  class="carbon-project-card"
  role="button"
  tabindex="0"
  on:click={handleClick}
  on:keydown={handleKeyDown}
>
  <div class="project-content">
    <h3 class="project-title cds--type-productive-heading-03">{title}</h3>
    <p class="project-description cds--type-body-long-01">{description}</p>
    
    <hr class="project-divider" />
    
    <div class="project-footer">
      <p class="project-tech cds--type-body-short-01">
        <strong class="tech-label">Stack:</strong> {tech.join(', ')}
      </p>
      <a 
        href={repoUrl} 
        target="_blank" 
        rel="noopener noreferrer" 
        class="repo-link cds--type-body-short-01"
        on:click={handleRepoClick}
      >
        Access Repository &rarr;
      </a>
    </div>
  </div>
</div>

<style>
  .carbon-project-card {
    /* Carbon tile-inspired styling */
    height: 100%;
    display: flex;
    flex-direction: column;
    cursor: pointer;
    transition: all var(--cds-productive-standard, 0.15s) cubic-bezier(0.2, 0, 0.38, 0.9);
    border: 1px solid var(--cds-border-subtle);
    background-color: var(--cds-layer);
    border-radius: var(--cds-border-radius, 0.5rem);
    overflow: hidden;
    box-shadow: var(--cds-shadow);
    position: relative;
  }

  .carbon-project-card:hover {
    border-color: var(--cds-interactive);
    box-shadow: var(--cds-shadow-raised);
    transform: translateY(-2px);
  }

  .carbon-project-card:focus {
    outline: 2px solid var(--cds-focus);
    outline-offset: 2px;
  }

  .carbon-project-card:active {
    transform: translateY(0);
    box-shadow: var(--cds-shadow);
  }

  .project-content {
    height: 100%;
    display: flex;
    flex-direction: column;
    padding: var(--cds-spacing-05);
  }

  .project-title {
    color: var(--cds-text-primary);
    margin-bottom: var(--cds-spacing-03);
  }

  .project-description {
    color: var(--cds-text-secondary);
    flex-grow: 1;
    margin-bottom: var(--cds-spacing-04);
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
  }

  .project-tech {
    color: var(--cds-text-secondary);
    margin-bottom: var(--cds-spacing-03);
  }

  .tech-label {
    font-weight: var(--cds-font-weight-semibold);
    color: var(--cds-text-primary);
  }

  .repo-link {
    font-weight: var(--cds-font-weight-semibold);
    color: var(--cds-interactive);
    text-decoration: none;
    transition: color var(--cds-productive-standard, 0.15s) cubic-bezier(0.2, 0, 0.38, 0.9);
  }

  .repo-link:hover {
    color: var(--cds-focus);
    text-decoration: underline;
  }

  .repo-link:focus {
    outline: 2px solid var(--cds-focus);
    outline-offset: 2px;
  }

  .repo-link:visited {
    color: var(--cds-interactive);
  }
</style>