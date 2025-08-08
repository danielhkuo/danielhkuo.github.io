<script lang="ts">
  import { onMount, tick } from "svelte";
  import { scale } from "svelte/transition";
  import {
    themes,
    applyCarbonTokens,
    createThemeTokenMapping,
    getThemeVariant,
  } from "../lib/themes";
  import type { CarbonThemeVariant } from "../lib/themes";

  // Carbon components
  import {
    Button,
    Toggle,
    Modal,
    ContentSwitcher,
    Switch,
  } from "carbon-components-svelte";
  import Settings from "carbon-icons-svelte/lib/Settings.svelte";
  import Light from "carbon-icons-svelte/lib/Light.svelte";
  import Asleep from "carbon-icons-svelte/lib/Asleep.svelte";
  import Laptop from "carbon-icons-svelte/lib/Laptop.svelte";

  // State
  let isOpen = false; // controls popover or modal
  let mounted = false;
  let isMobile = false; // responsive: < 672px uses Modal (bottom sheet)

  let currentThemeId: string = "nord";
  let currentMode: "light" | "dark" | "system" = "system";
  let modeIndex = 2; // 0=light, 1=dark, 2=system

  let triggerEl: any = null;
  let panelEl: HTMLElement | null = null;
  let media: MediaQueryList;
  let systemMQ: MediaQueryList;

  const MODES = ["light", "dark", "system"] as const;

  function resolveMode(): "light" | "dark" {
    return currentMode === "system"
      ? systemMQ?.matches
        ? "dark"
        : "light"
      : currentMode;
  }

  function applyThemeAndMode() {
    if (typeof document === "undefined") return;

    const resolved = resolveMode();
    const variant: CarbonThemeVariant = getThemeVariant(
      currentThemeId,
      resolved
    );

    document.documentElement.classList.toggle("dark", resolved === "dark");
    document.documentElement.dataset.theme = currentThemeId;

    const allTokens = createThemeTokenMapping(variant);
    for (const [key, value] of Object.entries(allTokens)) {
      document.documentElement.style.setProperty(key, value);
    }
    applyCarbonTokens(variant);
  }

  function selectTheme(themeId: string) {
    currentThemeId = themeId;
    localStorage.setItem("theme-id", themeId);
    applyThemeAndMode();
  }

  // keep these reactive syncs
  $: modeIndex = MODES.indexOf(currentMode);
  $: if (mounted) {
    // persist + apply whenever mode changes (including via switcher)
    localStorage.setItem("mode", currentMode);
    applyThemeAndMode();
  }

  function openPanel() {
    isOpen = true;
    // Add listeners immediately, not after tick
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("pointerdown", onDocPointerDown, true);

    tick().then(() => {
      // focus the first interactive element in the panel
      const first = panelEl?.querySelector<HTMLElement>(
        "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])"
      );
      first?.focus();
    });
  }

  function closePanel() {
    isOpen = false;
    document.removeEventListener("keydown", onKeyDown, true);
    document.removeEventListener("pointerdown", onDocPointerDown, true);
    triggerEl?.focus();
  }

  function togglePanel() {
    if (isOpen) closePanel();
    else openPanel();
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      closePanel();
    }
    // Trap focus when popover is open on desktop
    if (!isMobile && isOpen && panelEl && e.key === "Tab") {
      const focusables = Array.from(
        panelEl.querySelectorAll<HTMLElement>(
          "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])"
        )
      ).filter((el) => !el.hasAttribute("disabled"));
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (active === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
  }

  function onDocPointerDown(e: PointerEvent) {
    if (!isOpen) return;
    const target = e.target as Element;

    // Check if click is inside the panel or trigger button
    if (panelEl?.contains(target) || triggerEl?.contains(target)) return;

    // Check if click is on any Carbon component elements that might be portaled
    if (
      target.closest(".cds--content-switcher") ||
      target.closest(".bx--content-switcher") ||
      target.closest(".cds--content-switcher-btn") ||
      target.closest(".bx--content-switcher-btn")
    ) {
      return;
    }

    // Clicked outside - close panel
    closePanel();
  }

  onMount(() => {
    // Initial state from BaseHead script
    currentThemeId = localStorage.getItem("theme-id") || "nord";

    // updated: allow "system"
    const storedMode = localStorage.getItem("mode") as
      | "light"
      | "dark"
      | "system"
      | null;
    currentMode =
      storedMode === "light" || storedMode === "dark" || storedMode === "system"
        ? storedMode
        : "system";

    // system preference listener
    systemMQ = window.matchMedia("(prefers-color-scheme: dark)");
    const onSystemChange = () => {
      if (currentMode === "system") applyThemeAndMode();
    };
    systemMQ.addEventListener("change", onSystemChange);

    // Responsive breakpoint: Carbon sm -> 672px
    media = window.matchMedia("(max-width: 671px)");
    const setMobile = () => (isMobile = media.matches);
    setMobile();
    media.addEventListener("change", setMobile);

    mounted = true;
    applyThemeAndMode();

    return () => {
      media.removeEventListener("change", setMobile);
      systemMQ?.removeEventListener("change", onSystemChange);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("pointerdown", onDocPointerDown, true);
    };
  });
</script>

<div class="fab-container">
  {#if !isMobile}
    <!-- Desktop/Tablet: Carbon-style Popover anchored to the FAB -->
    {#if isOpen}
      <div
        bind:this={panelEl}
        class="settings-popover"
        role="dialog"
        aria-modal="false"
        aria-labelledby="settings-title"
        transition:scale={{ duration: 120, start: 0.98 }}
        style="--elevation: var(--cds-shadow, 0 10px 30px rgba(0,0,0,0.2));"
      >
        <div class="setting-section">
          <h3 id="settings-title" class="panel-title">Theme</h3>
          <div class="theme-grid">
            {#each themes as theme (theme.id)}
              <Button
                kind={currentThemeId === theme.id ? "primary" : "ghost"}
                size="small"
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
                    style="background-color: {theme.variants.dark[
                      '--primary'
                    ]};"
                  ></div>
                  <div
                    class="swatch-color"
                    style="background-color: {theme.variants.light[
                      '--background'
                    ]};"
                  ></div>
                  <div
                    class="swatch-color"
                    style="background-color: {theme.variants.light[
                      '--primary'
                    ]};"
                  ></div>
                </div>
                <span class="theme-name">{theme.name}</span>
              </Button>
            {/each}
          </div>
        </div>

        <div class="setting-section">
          <h3 class="panel-title">Mode</h3>
          <div class="mode-switcher">
            <ContentSwitcher
              size="sm"
              bind:selectedIndex={modeIndex}
              aria-label="Theme mode"
            >
              <Switch text="Light" on:click={() => (currentMode = "light")} />
              <Switch text="Dark" on:click={() => (currentMode = "dark")} />
              <Switch text="System" on:click={() => (currentMode = "system")} />
            </ContentSwitcher>
          </div>
        </div>
      </div>
    {/if}
  {:else}
    <!-- Mobile: Bottom sheet via Carbon Modal -->
    <Modal
      size="sm"
      passiveModal={true}
      hasScrollingContent={true}
      bind:open={isOpen}
      on:close={() => (isOpen = false)}
      class="settings-sheet"
    >
      <h3 slot="heading" id="settings-title-mobile">Settings</h3>
      <div class="sheet-content">
        <div class="setting-section">
          <h4 class="panel-title">Theme</h4>
          <div class="theme-grid">
            {#each themes as theme (theme.id)}
              <Button
                kind={currentThemeId === theme.id ? "primary" : "ghost"}
                size="small"
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
                    style="background-color: {theme.variants.dark[
                      '--primary'
                    ]};"
                  ></div>
                  <div
                    class="swatch-color"
                    style="background-color: {theme.variants.light[
                      '--background'
                    ]};"
                  ></div>
                  <div
                    class="swatch-color"
                    style="background-color: {theme.variants.light[
                      '--primary'
                    ]};"
                  ></div>
                </div>
                <span class="theme-name">{theme.name}</span>
              </Button>
            {/each}
          </div>
        </div>

        <div class="setting-section">
          <h4 class="panel-title">Mode</h4>
          <div class="mode-switcher">
            <ContentSwitcher
              size="sm"
              bind:selectedIndex={modeIndex}
              aria-label="Theme mode"
            >
              <Switch text="Light" on:click={() => (currentMode = "light")} />
              <Switch text="Dark" on:click={() => (currentMode = "dark")} />
              <Switch text="System" on:click={() => (currentMode = "system")} />
            </ContentSwitcher>
          </div>
        </div>
      </div>
    </Modal>
  {/if}

  <!-- Trigger FAB -->
  <Button
    bind:this={triggerEl}
    kind="primary"
    size="field"
    icon={Settings}
    aria-haspopup="dialog"
    aria-expanded={isOpen}
    aria-controls="settings-popover"
    on:click={togglePanel}
    class="fab-button main {isOpen ? 'rotate-45' : ''}"
    title="Settings"
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

  :global(.fab-button.main) {
    border-radius: 50% !important;
    width: 48px !important;
    height: 48px !important;
    min-height: 48px !important;
    background-color: var(--primary) !important;
    border: 1px solid var(--primary) !important;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1) !important;
    transition:
      transform 120ms ease,
      box-shadow 120ms ease,
      background-color 120ms ease !important;
    position: relative;
    z-index: 2;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    padding: 0 !important;
  }

  :global(.fab-button.main svg) {
    width: 20px !important;
    height: 20px !important;
    color: var(--primary-text) !important;
  }

  :global(.fab-button.main:hover) {
    background-color: var(--primary-hover) !important;
    border-color: var(--primary-hover) !important;
    box-shadow: 0 4px 15px rgba(0, 0, 0, 0.15) !important;
    transform: scale(1.05);
  }
  :global(.fab-button.main.rotate-45 svg) {
    transform: rotate(45deg);
    transition: transform 0.2s ease;
  }

  /* Popover (desktop/tablet) */
  .settings-popover {
    position: absolute;
    bottom: calc(100% + 0.75rem);
    right: 0;
    width: 300px;
    background-color: var(--cds-layer);
    border: 1px solid var(--cds-border-subtle);
    border-radius: 0.75rem;
    padding: 1rem;
    box-shadow: var(--cds-shadow, 0 10px 30px rgba(0, 0, 0, 0.2));
    display: flex;
    flex-direction: column;
    gap: 1rem;
    outline: none;
  }

  /* Popover caret */
  .settings-popover::after {
    content: "";
    position: absolute;
    bottom: -8px;
    right: 16px;
    width: 16px;
    height: 16px;
    background: var(--cds-layer);
    border-right: 1px solid var(--cds-border-subtle);
    border-bottom: 1px solid var(--cds-border-subtle);
    transform: rotate(45deg);
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

  :global(.theme-button) {
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

  .mode-switcher {
    display: flex;
  }

  /* make the ContentSwitcher stretch and buttons share space */
  :global(.mode-switcher .bx--content-switcher),
  :global(.mode-switcher .cds--content-switcher) {
    width: 100%;
  }

  :global(.mode-switcher .bx--content-switcher-btn),
  :global(.mode-switcher .cds--content-switcher-btn) {
    flex: 1;
    justify-content: center;
  }

  /* Mobile sheet tweaks */
  :global(.settings-sheet .cds--modal-container) {
    max-width: 640px;
    width: 100%;
  }
  .sheet-content {
    padding: var(--cds-spacing-05);
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .setting-section {
    margin-bottom: 0.5rem;
  }
</style>
