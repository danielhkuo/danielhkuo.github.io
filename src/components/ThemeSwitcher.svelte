<script lang="ts">
  import { onMount } from "svelte";
  import { fade, scale } from "svelte/transition";
  import { themes } from "../scripts/theme-manager";
  import Settings from "carbon-icons-svelte/lib/Settings.svelte";
  import Checkmark from "carbon-icons-svelte/lib/Checkmark.svelte";
  import Light from "carbon-icons-svelte/lib/Light.svelte";
  import Asleep from "carbon-icons-svelte/lib/Asleep.svelte";
  import Laptop from "carbon-icons-svelte/lib/Laptop.svelte";

  let isOpen = false;
  let currentThemeId = "nord";
  let currentMode: "light" | "dark" | "system" = "system";
  let mounted = false;

  // Icons for mode switcher
  const modeIcons = {
    light: Light,
    dark: Asleep,
    system: Laptop
  };

  function toggleMenu() {
    isOpen = !isOpen;
  }

  function closeMenu() {
    isOpen = false;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape" && isOpen) {
      closeMenu();
    }
  }

  function handleClickOutside(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (isOpen && !target.closest(".theme-switcher-container")) {
      closeMenu();
    }
  }

  function setTheme(id: string) {
    currentThemeId = id;
    localStorage.setItem("theme-id", id);
    updateTheme();
  }

  function setMode(mode: "light" | "dark" | "system") {
    currentMode = mode;
    localStorage.setItem("mode", mode);
    updateTheme();
  }

  function updateTheme() {
    if (typeof document === "undefined") return;

    // 1. Set Data Theme
    document.documentElement.setAttribute("data-theme", currentThemeId);

    // 2. Resolve Mode
    let resolvedMode = currentMode;
    if (currentMode === "system") {
      resolvedMode = window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    }

    // 3. Set Dark Class & Carbon Theme
    const isDark = resolvedMode === "dark";
    document.documentElement.classList.toggle("dark", isDark);
    document.documentElement.setAttribute(
      "data-carbon-theme",
      isDark ? "g100" : "white"
    );
  }

  onMount(() => {
    currentThemeId = localStorage.getItem("theme-id") || "nord";
    const savedMode = localStorage.getItem("mode");
    if (savedMode === "light" || savedMode === "dark" || savedMode === "system") {
      currentMode = savedMode;
    }
    
    mounted = true;
    updateTheme();

    // System preference listener
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => {
      if (currentMode === "system") updateTheme();
    };
    mediaQuery.addEventListener("change", handleChange);

    window.addEventListener("click", handleClickOutside);
    window.addEventListener("keydown", handleKeydown);

    return () => {
      mediaQuery.removeEventListener("change", handleChange);
      window.removeEventListener("click", handleClickOutside);
      window.removeEventListener("keydown", handleKeydown);
    };
  });
</script>

<div class="theme-switcher-container">
  <button
    class="fab {isOpen ? 'open' : ''}"
    on:click={toggleMenu}
    aria-label="Theme Settings"
    aria-expanded={isOpen}
  >
    <Settings size={20} />
  </button>

  {#if isOpen}
    <div
      class="menu"
      transition:scale={{ duration: 200, start: 0.95, opacity: 0 }}
    >
      <div class="section">
        <h3 class="section-title">Mode</h3>
        <div class="mode-toggle">
          {#each Object.entries(modeIcons) as [mode, Icon]}
            <button
              class="mode-btn {currentMode === mode ? 'active' : ''}"
              on:click={() => setMode(mode as any)}
              title={mode.charAt(0).toUpperCase() + mode.slice(1)}
            >
              <svelte:component this={Icon} size={16} />
            </button>
          {/each}
        </div>
      </div>

      <div class="section">
        <h3 class="section-title">Theme</h3>
        <div class="theme-list">
          {#each themes as theme}
            <button
              class="theme-btn {currentThemeId === theme.id ? 'active' : ''}"
              on:click={() => setTheme(theme.id)}
            >
              <div class="swatch-container">
                <div class="swatch" style="background: {theme.colors.dark.background}"></div>
                <div class="swatch" style="background: {theme.colors.light.primary}"></div>
              </div>
              <span class="theme-name">{theme.name}</span>
              {#if currentThemeId === theme.id}
                <Checkmark size={16} class="check-icon" />
              {/if}
            </button>
          {/each}
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .theme-switcher-container {
    position: fixed;
    bottom: 1.5rem;
    right: 1.5rem;
    z-index: 1000;
  }

  .fab {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    background: var(--primary);
    color: var(--background);
    border: none;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: transform 0.2s ease, background 0.2s ease;
  }

  .fab:hover {
    transform: scale(1.05);
    background: var(--secondary);
  }

  .fab.open {
    transform: rotate(45deg);
  }

  .menu {
    position: absolute;
    bottom: 60px;
    right: 0;
    width: 260px;
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 1rem;
    box-shadow: 0 10px 25px rgba(0, 0, 0, 0.1);
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .section-title {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-secondary);
    margin: 0 0 0.5rem 0;
    font-weight: 600;
  }

  /* Mode Toggle */
  .mode-toggle {
    display: flex;
    background: var(--background);
    padding: 4px;
    border-radius: 8px;
    gap: 4px;
  }

  .mode-btn {
    flex: 1;
    border: none;
    background: transparent;
    color: var(--text-secondary);
    padding: 6px;
    border-radius: 6px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s ease;
  }

  .mode-btn:hover {
    color: var(--text);
    background: rgba(0, 0, 0, 0.05);
  }

  .mode-btn.active {
    background: var(--card-bg);
    color: var(--primary);
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
  }

  /* Theme List */
  .theme-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .theme-btn {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    width: 100%;
    padding: 0.5rem;
    border: 1px solid transparent;
    background: transparent;
    border-radius: 8px;
    cursor: pointer;
    color: var(--text);
    transition: all 0.2s ease;
  }

  .theme-btn:hover {
    background: var(--background);
  }

  .theme-btn.active {
    background: var(--background);
    border-color: var(--primary);
  }

  .swatch-container {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    overflow: hidden;
    display: flex;
    border: 1px solid var(--border);
  }

  .swatch {
    flex: 1;
    height: 100%;
  }

  .theme-name {
    font-size: 0.9rem;
    font-weight: 500;
    flex: 1;
    text-align: left;
  }

  :global(.check-icon) {
    color: var(--primary);
  }
</style>
