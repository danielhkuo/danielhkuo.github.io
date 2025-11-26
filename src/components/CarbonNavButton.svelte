<script>
  import { Button } from 'carbon-components-svelte';
  
  export let href = '';
</script>

<div class="carbon-nav-button">
  <Button 
    kind="ghost" 
    size="lg"
    {href}
    class="nav-button-carbon"
  >
    <slot />
  </Button>
</div>

<style>
  /* Carbon Navigation Button Styling */
  .carbon-nav-button {
    position: relative;
  }

  /* Override Carbon button styles to match original design */
  /* Increased specificity to avoid !important */
  div.carbon-nav-button :global(.bx--btn--ghost) {
    background: transparent;
    border: none;
    color: var(--cds-text-primary);
    font-family: 'IBM Plex Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 1.125rem; /* text-lg equivalent */
    font-weight: normal;
    padding: 0.5rem 0; /* py-2 equivalent */
    min-height: auto;
    text-decoration: none;
    transition: color 0.3s ease;
    position: relative;
    overflow: visible;
    cursor: pointer;
  }

  div.carbon-nav-button :global(.bx--btn--ghost:hover) {
    background: transparent;
    color: var(--cds-interactive);
  }

  div.carbon-nav-button :global(.bx--btn--ghost:focus) {
    background: transparent;
    color: var(--cds-interactive);
    outline: 2px solid var(--cds-focus);
    outline-offset: 2px;
    box-shadow: none;
  }

  div.carbon-nav-button :global(.bx--btn--ghost:active) {
    background: transparent;
    color: var(--cds-interactive);
  }

  /* Custom underline animation using pseudo-element */
  div.carbon-nav-button :global(.bx--btn--ghost::after) {
    content: '';
    position: absolute;
    bottom: 0;
    left: 0;
    width: 100%;
    height: 2px;
    background-color: var(--cds-interactive);
    transform: scaleX(0);
    transform-origin: center;
    transition: transform 0.3s ease;
  }

  div.carbon-nav-button :global(.bx--btn--ghost:hover::after) {
    transform: scaleX(1);
  }

  /* Ensure proper spacing and alignment */
  div.carbon-nav-button :global(.bx--btn__icon) {
    display: none; /* Hide any default icons */
  }
</style>