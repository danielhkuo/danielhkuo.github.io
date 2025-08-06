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
  .carbon-nav-button :global(.bx--btn--ghost) {
    background: transparent !important;
    border: none !important;
    color: var(--cds-text-primary) !important;
    font-family: 'Atkinson', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
    font-size: 1.125rem !important; /* text-lg equivalent */
    font-weight: normal !important;
    padding: 0.5rem 0 !important; /* py-2 equivalent */
    min-height: auto !important;
    text-decoration: none !important;
    transition: color 0.3s ease !important;
    position: relative !important;
    overflow: visible !important;
    cursor: pointer !important;
  }

  .carbon-nav-button :global(.bx--btn--ghost:hover) {
    background: transparent !important;
    color: var(--cds-interactive) !important;
  }

  .carbon-nav-button :global(.bx--btn--ghost:focus) {
    background: transparent !important;
    color: var(--cds-interactive) !important;
    outline: 2px solid var(--cds-focus) !important;
    outline-offset: 2px !important;
    box-shadow: none !important;
  }

  .carbon-nav-button :global(.bx--btn--ghost:active) {
    background: transparent !important;
    color: var(--cds-interactive) !important;
  }

  /* Custom underline animation using pseudo-element */
  .carbon-nav-button :global(.bx--btn--ghost::after) {
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

  .carbon-nav-button :global(.bx--btn--ghost:hover::after) {
    transform: scaleX(1);
  }

  /* Ensure proper spacing and alignment */
  .carbon-nav-button :global(.bx--btn__icon) {
    display: none; /* Hide any default icons */
  }
</style>