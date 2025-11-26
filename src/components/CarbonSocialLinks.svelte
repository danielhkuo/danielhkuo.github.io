<script lang="ts">
  import { Button } from 'carbon-components-svelte';
  import LogoInstagram from "carbon-icons-svelte/lib/LogoInstagram.svelte";
  import LogoLinkedin from "carbon-icons-svelte/lib/LogoLinkedin.svelte";
  import LogoGithub from "carbon-icons-svelte/lib/LogoGithub.svelte";
  import LogoTwitter from "carbon-icons-svelte/lib/LogoTwitter.svelte";

  interface SocialLink {
    href: string;
    label: string;
    icon: any;
  }

  const socialLinks: SocialLink[] = [
    {
      href: 'https://www.instagram.com/danielhankuo/',
      label: 'Daniel Kuo on Instagram',
      icon: LogoInstagram
    },
    {
      href: 'https://linkedin.com/in/danielhkuo',
      label: 'Daniel Kuo on LinkedIn', 
      icon: LogoLinkedin
    },
    {
      href: 'https://twitter.com',
      label: 'Daniel Kuo on Twitter',
      icon: LogoTwitter
    },
    {
      href: 'https://github.com/danielhkuo',
      label: 'Daniel Kuo on GitHub',
      icon: LogoGithub
    }
  ];
</script>

<div class="social-row flex flex-wrap justify-center lg:justify-start gap-2">
  {#each socialLinks as link}
    <Button
      kind="ghost"
      size="sm"
      href={link.href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={link.label}
      class="social-button"
      tooltipPosition="bottom"
      iconDescription={link.label}
    >
      <svelte:component this={link.icon} size={24} />
    </Button>
  {/each}
</div>

<style>
  .social-row {
    /* 
       "Staircase" Fix:
       Carbon Ghost buttons have internal padding (approx 12px/0.75rem).
       To align the ICON visually with the text above it, we must pull 
       the container left by that exact padding amount.
    */
    margin-left: -12px; 
    
    /* Reduced top margin to tighten the layout ("Trapped Whitespace" Fix) */
    margin-top: 0.5rem;
  }

  /* Reset alignment for mobile */
  @media (max-width: 671px) {
    .social-row {
      margin-left: 0;
      justify-content: center;
    }
  }

  :global(.social-button) {
    min-height: 48px !important;
    width: 48px !important;
    padding: 12px !important;
    background: transparent !important;
    border: none !important;
    border-radius: 8px !important;
    color: var(--cds-text-secondary) !important;
    transition: all 0.15s ease !important;
  }

  :global(.social-button:hover) {
    background: var(--cds-hover-ui, var(--cds-layer-hover)) !important;
    color: var(--cds-text-primary) !important;
    transform: translateY(-2px) !important;
  }

  :global(.social-button:focus) {
    outline: 2px solid var(--cds-focus) !important;
    outline-offset: 2px !important;
    background: var(--cds-hover-ui, var(--cds-layer-hover)) !important;
  }

  :global(.social-button:active) {
    background: var(--cds-active-ui, var(--cds-layer-active)) !important;
    transform: translateY(0) !important;
  }

  :global(.social-button svg) {
    width: 24px !important;
    height: 24px !important;
  }
</style>