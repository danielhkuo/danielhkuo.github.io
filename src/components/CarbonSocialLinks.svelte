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

<div class="social-row flex justify-center items-center gap-4">
  {#each socialLinks as link}
    <Button
      kind="ghost"
      size="sm"
      href={link.href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={link.label}
      class="social-button"
    >
      <svelte:component this={link.icon} size={24} />
    </Button>
  {/each}
</div>

<style>
  .social-row {
    text-align: center;
    padding: 1.5rem 0 1rem 0;
    margin-top: 0.75rem;
  }

  @media (min-width: 768px) {
    .social-row {
      padding: 1rem 0;
      margin-top: 0.5rem;
    }
  }

  :global(.social-button) {
    /* Clean Carbon button styling */
    min-height: 48px !important;
    width: 48px !important;
    padding: 12px !important;
    background: transparent !important;
    border: none !important;
    border-radius: 8px !important;
    color: var(--cds-text-primary) !important;
    transition: all 0.15s ease !important;
  }

  :global(.social-button:hover) {
    background: var(--cds-hover-ui, var(--cds-layer-hover)) !important;
    color: var(--cds-text-primary) !important;
    transform: translateY(-1px) !important;
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

  /* Ensure icons are properly sized and centered */
  :global(.social-button svg) {
    width: 24px !important;
    height: 24px !important;
  }
</style>