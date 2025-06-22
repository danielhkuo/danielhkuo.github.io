<script lang="ts">
  import { onMount } from 'svelte';
  import { fade } from 'svelte/transition';
  import { themes } from '../lib/themes';
  import type { ThemeVariant } from '../lib/themes';

  let isSettingsOpen = false;
  let mounted = false;

  // Component state for the current theme and mode
  let currentThemeId: string = 'nord';
  let currentMode: 'light' | 'dark' = 'light';

  /**
   * Applies the selected theme and mode by setting CSS custom properties
   * on the root <html> element. This is our single source of truth for styling.
   * It also manages the `.dark` class for Tailwind CSS compatibility.
   */
  function applyThemeAndMode() {
    // Guard against running in a non-browser environment (SSR)
    if (typeof document === 'undefined') return;

    // Find the full theme object, or fall back to the first one
    const theme = themes.find(t => t.id === currentThemeId) || themes[0];
    const variant: ThemeVariant = theme.variants[currentMode];

    // Set the .dark class for any Tailwind CSS dark mode selectors
    document.documentElement.classList.toggle('dark', currentMode === 'dark');
    
    // Set the data-theme attribute for reference or CSS targeting if needed
    document.documentElement.dataset.theme = currentThemeId;

    // Programmatically set all CSS variables from the theme variant object
    for (const [key, value] of Object.entries(variant)) {
      document.documentElement.style.setProperty(key, value);
    }
  }

  // onMount runs after the component is added to the DOM
  onMount(() => {
    // Sync component state with the initial state set by the inline script in BaseHead.astro
    // This ensures a seamless handover from the initial paint to the interactive component.
    currentThemeId = localStorage.getItem('theme-id') || 'nord';
    const storedMode = localStorage.getItem('mode');
    
    if (storedMode === 'light' || storedMode === 'dark') {
      currentMode = storedMode;
    } else {
      // If no mode is stored, respect the user's OS preference
      currentMode = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    
    // The initial theme application is handled by the inline script to prevent FOUC.
    // We just need to ensure our component state is up-to-date.
    mounted = true; // Enable animations and interactive elements
  });

  function toggleSettings() {
    isSettingsOpen = !isSettingsOpen;
  }

  function selectTheme(themeId: string) {
    currentThemeId = themeId;
    localStorage.setItem('theme-id', themeId);
    applyThemeAndMode();
  }

  // This function handles the change event from the toggle switch.
  function handleToggleChange(event: Event) {
    const target = event.target as HTMLInputElement;
    currentMode = target.checked ? 'dark' : 'light';
    localStorage.setItem('mode', currentMode);
    applyThemeAndMode();
  }

  // Reactive derived state: `isDark` is always in sync with `currentMode`
  $: isDark = currentMode === 'dark';

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
            <button
              on:click={() => selectTheme(theme.id)}
              class="theme-button"
              class:selected={currentThemeId === theme.id}
              title={theme.name}
              aria-label={`Select ${theme.name} theme`}
            >
              <div class="theme-swatch">
                <div class="swatch-color" style="background-color: {theme.variants.dark['--background']};"></div>
                <div class="swatch-color" style="background-color: {theme.variants.dark['--primary']};"></div>
                <div class="swatch-color" style="background-color: {theme.variants.light['--background']};"></div>
                <div class="swatch-color" style="background-color: {theme.variants.light['--primary']};"></div>
              </div>
              <span class="theme-name">{theme.name}</span>
            </button>
          {/each}
        </div>
      </div>

      <!-- Mode Toggle -->
      <div class="setting-section">
        <h3 class="panel-title">Mode</h3>
        <div class="mode-toggle">
          <i class="fas fa-sun"></i>
          <label class="switch" aria-label="Toggle dark mode">
            <input type="checkbox" checked={isDark} on:change={handleToggleChange}>
            <span class="slider"></span>
          </label>
          <i class="fas fa-moon"></i>
        </div>
      </div>
    </div>
  {/if}

  <!-- Main FAB Button -->
  <button on:click={toggleSettings} class="fab-button main" aria-label="Open settings">
    {#if mounted}
      <i class="fas fa-cog transition-transform duration-300" class:rotate-45={isSettingsOpen}></i>
    {:else}
      <!-- Show a loading pulse before the component is fully mounted to prevent layout shift -->
      <div class="w-6 h-6 bg-current opacity-20 rounded-full animate-pulse"></div>
    {/if}
  </button>
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

  .fab-button {
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    border: 1px solid var(--border);
    color: var(--text-secondary);
    background-color: var(--card-bg);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    cursor: pointer;
  }
  .fab-button:hover {
    color: var(--primary);
    border-color: var(--primary);
    box-shadow: 0 4px 15px -5px var(--primary);
  }
  .fab-button:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 2px;
  }

  .main {
    width: 48px;
    height: 48px;
    font-size: 1.25rem;
    position: relative;
    z-index: 2;
  }

  .rotate-45 {
    transform: rotate(45deg);
  }

  .settings-panel {
    position: absolute;
    bottom: calc(100% + 0.75rem);
    right: 0;
    width: 280px;
    background-color: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: 0.75rem; /* rounded-lg */
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
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 0.5rem;
    font-family: var(--font-sans, sans-serif);
  }

  .theme-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 0.5rem;
  }

  .theme-button {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem;
    border-radius: 0.5rem;
    border: 2px solid transparent;
    background-color: var(--background);
    transition: all 0.2s ease;
    cursor: pointer;
    color: var(--text);
    font-family: inherit;
  }
  .theme-button:hover {
    border-color: var(--secondary);
  }
  .theme-button.selected {
    border-color: var(--primary);
    box-shadow: 0 0 0 1px var(--primary);
  }

  .theme-swatch {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    overflow: hidden;
    display: grid;
    grid-template-columns: 1fr 1fr;
    transform: rotate(45deg);
    border: 1px solid var(--border);
  }
  .swatch-color {
    width: 100%;
    height: 100%;
  }

  .theme-name {
    font-size: 0.875rem;
    font-weight: 500;
  }

  .mode-toggle {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background-color: var(--background);
    padding: 0.5rem 1rem;
    border-radius: 9999px;
  }
  .mode-toggle i {
    font-size: 1.2rem;
    color: var(--text-secondary);
  }

  /* Modern Toggle Switch */
  .switch {
    position: relative;
    display: inline-block;
    width: 50px;
    height: 28px;
  }
  .switch input {
    opacity: 0;
    width: 0;
    height: 0;
  }
  .slider {
    position: absolute;
    cursor: pointer;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: var(--secondary);
    transition: 0.4s;
    border-radius: 28px;
  }
  .slider:before {
    position: absolute;
    content: "";
    height: 20px;
    width: 20px;
    left: 4px;
    bottom: 4px;
    background-color: var(--background);
    transition: 0.4s;
    border-radius: 50%;
  }
  input:checked + .slider {
    background-color: var(--primary);
  }
  input:checked + .slider:before {
    transform: translateX(22px);
  }
</style>