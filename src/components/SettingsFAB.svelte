<script lang="ts">
  import { onMount } from "svelte";
  import { fade } from "svelte/transition";
  import {
    themes,
    applyCarbonTokens,
    createThemeTokenMapping,
    getThemeVariant,
  } from "../lib/themes";
  import type { CarbonThemeVariant } from "../lib/themes";

  // Carbon component imports
  import { Button } from "carbon-components-svelte";
  import { Toggle } from "carbon-components-svelte";
  import Settings from "carbon-icons-svelte/lib/Settings.svelte";
  import Light from "carbon-icons-svelte/lib/Light.svelte";
  import Asleep from "carbon-icons-svelte/lib/Asleep.svelte";

  let isSettingsOpen = false;
  let mounted = false;

  // Component state for the current theme and mode
  let currentThemeId: string = "nord";
  let currentMode: "light" | "dark" = "light";

  /**
   * Applies the selected theme and mode by setting CSS custom properties
   * on the root <html> element. This is our single source of truth for styling.
   * It also manages the `.dark` class for dark mode compatibility and
   * applies Carbon design tokens.
   */
  function applyThemeAndMode() {
    // Guard against running in a non-browser environment (SSR)
    if (typeof document === "undefined") return;

    // Get the theme variant with Carbon mappings
    const variant: CarbonThemeVariant = getThemeVariant(
      currentThemeId,
      currentMode
    );

    // Set the .dark class for dark mode selectors
    document.documentElement.classList.toggle("dark", currentMode === "dark");

    // Set the data-theme attribute for reference or CSS targeting if needed
    document.documentElement.dataset.theme = currentThemeId;

    // Apply both custom CSS variables and Carbon design tokens
    const allTokens = createThemeTokenMapping(variant);
    for (const [key, value] of Object.entries(allTokens)) {
      document.documentElement.style.setProperty(key, value);
    }

    // Apply Carbon-specific theme configuration
    applyCarbonTokens(variant);
  }

  // onMount runs after the component is added to the DOM
  onMount(() => {
    // Sync component state with the initial state set by the inline script in BaseHead.astro
    // This ensures a seamless handover from the initial paint to the interactive component.
    currentThemeId = localStorage.getItem("theme-id") || "nord";
    const storedMode = localStorage.getItem("mode");

    if (storedMode === "light" || storedMode === "dark") {
      currentMode = storedMode;
    } else {
      // If no mode is stored, respect the user's OS preference
      currentMode = window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    }

    // Update isDark to match the current mode
    isDark = currentMode === "dark";

    // The initial theme application is handled by the inline script to prevent FOUC.
    // We just need to ensure our component state is up-to-date.
    mounted = true; // Enable animations and interactive elements
  });

  function toggleSettings() {
    isSettingsOpen = !isSettingsOpen;
  }

  function selectTheme(themeId: string) {
    currentThemeId = themeId;
    localStorage.setItem("theme-id", themeId);
    applyThemeAndMode();
  }

  // Reactive derived state: `isDark` is always in sync with `currentMode`
  let isDark = currentMode === "dark";

  // Watch for changes to isDark and update the mode
  $: if (mounted && isDark !== (currentMode === "dark")) {
    currentMode = isDark ? "dark" : "light";
    localStorage.setItem("mode", currentMode);
    applyThemeAndMode();
  }
</script>

<div class="fab-container">
  <!-- Settings Panel -->
  {#if isSettingsOpen}
    <div transition:fade={{ duration: 200 }} class="settings-panel">
      <!-- Theme Selector -->
      <div class="setting-section">
        <h3 class="panel-title">Theme</h3>
        <div class="theme-grid">
          {#each themes as theme (theme.id)}
            <Button
              kind={currentThemeId === theme.id ? "primary" : "ghost"}
              size="sm"
              on:click={() => selectTheme(theme.id)}
              class="theme-button"
              title={theme.name}
              aria-label={`Select ${theme.name} theme`}
            >
              <div class="theme-swatch">
                <div
                  class="swatch-color"
                  style="background-color: {theme.variants.dark[
                    '--background'
                  ]};"
                ></div>
                <div
                  class="swatch-color"
                  style="background-color: {theme.variants.dark['--primary']};"
                ></div>
                <div
                  class="swatch-color"
                  style="background-color: {theme.variants.light[
                    '--background'
                  ]};"
                ></div>
                <div
                  class="swatch-color"
                  style="background-color: {theme.variants.light['--primary']};"
                ></div>
              </div>
              <span class="theme-name">{theme.name}</span>
            </Button>
          {/each}
        </div>
      </div>

      <!-- Mode Toggle -->
      <div class="setting-section">
        <h3 class="panel-title">Mode</h3>
        <div class="mode-toggle">
          <Light />
          <Toggle
            bind:toggled={isDark}
            labelA="Light mode"
            labelB="Dark mode"
            hideLabel
            size="sm"
          />
          <Asleep />
        </div>
      </div>
    </div>
  {/if}

  <!-- Main FAB Button -->
  <Button
    kind="primary"
    size="field"
    iconOnly
    icon={Settings}
    on:click={toggleSettings}
    class="fab-button main {isSettingsOpen ? 'rotate-45' : ''}"
    tooltipPosition="left"
    tooltipText="Settings"
  />
</div>

<style>
  .fab-container {
    position: fixed;
    bottom: 1.5rem;
    right: 1.5rem;
    z-index: 1000;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
  }

  /* Carbon FAB Button Styling */
  :global(.fab-container .main) {
    border-radius: 50% !important;
    width: 48px !important;
    height: 48px !important;
    min-height: 48px !important;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1) !important;
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1) !important;
    position: relative;
    z-index: 2;
  }

  :global(.fab-container .main:hover) {
    box-shadow: 0 4px 15px -5px var(--cds-interactive) !important;
    transform: scale(1.05);
  }

  :global(.fab-container .main.rotate-45 svg) {
    transform: rotate(45deg);
    transition: transform 0.3s ease;
  }

  .settings-panel {
    position: absolute;
    bottom: calc(100% + 0.75rem);
    right: 0;
    width: 280px;
    background-color: var(--cds-layer);
    border: 1px solid var(--cds-border-subtle);
    border-radius: 0.75rem;
    padding: 1rem;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
    z-index: 3;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .panel-title {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--cds-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 0.5rem;
    font-family:
      "IBM Plex Sans",
      -apple-system,
      BlinkMacSystemFont,
      "Segoe UI",
      Roboto,
      sans-serif;
  }

  .theme-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 0.5rem;
  }

  /* Carbon Theme Button Styling */
  :global(.theme-grid .theme-button) {
    display: flex !important;
    flex-direction: column !important;
    align-items: center !important;
    gap: 0.5rem !important;
    padding: 0.5rem !important;
    border-radius: 0.5rem !important;
    min-height: auto !important;
    height: auto !important;
    width: 100% !important;
  }

  .theme-swatch {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    overflow: hidden;
    display: grid;
    grid-template-columns: 1fr 1fr;
    transform: rotate(45deg);
    border: 1px solid var(--cds-border-subtle);
  }

  .swatch-color {
    width: 100%;
    height: 100%;
  }

  .theme-name {
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--cds-text-primary);
  }

  .mode-toggle {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background-color: var(--cds-field);
    padding: 0.5rem 1rem;
    border-radius: 9999px;
    border: 1px solid var(--cds-border-subtle);
  }

  /* Carbon Toggle Icon Styling */
  :global(.mode-toggle svg) {
    width: 1.2rem;
    height: 1.2rem;
    color: var(--cds-icon-secondary);
  }

  /* Carbon Toggle Styling */
  :global(.mode-toggle .bx--toggle) {
    margin: 0 0.5rem;
  }
</style>
