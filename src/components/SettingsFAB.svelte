<script>
  import { onMount } from 'svelte';
  import { fly } from 'svelte/transition';

  let isFabOpen = false;
  let isAccentPickerOpen = false;
  let mounted = false;

  // --- State from ThemeToggle ---
  let isDark = false;

  // --- State from AccentPicker ---
  const accentOptions = [
    { name: 'Arctic Ice', color: '#8FBCBB', id: 'nord-7' },
    { name: 'Frost Blue', color: '#88C0D0', id: 'nord-8' },
    { name: 'Polar Blue', color: '#81A1C1', id: 'nord-9' },
    { name: 'Deep Frost', color: '#5E81AC', id: 'nord-10' },
    { name: 'Aurora Red', color: '#BF616A', id: 'nord-11' },
    { name: 'Aurora Orange', color: '#D08770', id: 'nord-12' },
    { name: 'Aurora Yellow', color: '#EBCB8B', id: 'nord-13' },
    { name: 'Aurora Green', color: '#A3BE8C', id: 'nord-14' },
    { name: 'Aurora Purple', color: '#B48EAD', id: 'nord-15' }
  ];
  let currentAccent = accentOptions[1]; // Default to Frost Blue

  // --- Merged onMount Logic ---
  onMount(() => {
    // Theme initialization
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme) {
      isDark = savedTheme === 'dark';
    } else {
      isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    updateTheme();

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleThemeChange = (e) => {
      if (!localStorage.getItem('theme')) {
        isDark = e.matches;
        updateTheme();
      }
    };
    mediaQuery.addEventListener('change', handleThemeChange);

    // Accent initialization
    const savedAccent = localStorage.getItem('accent-color');
    if (savedAccent) {
      const foundAccent = accentOptions.find(option => option.id === savedAccent);
      if (foundAccent) {
        currentAccent = foundAccent;
        applyAccent(currentAccent);
      }
    } else {
      applyAccent(currentAccent);
    }
    
    mounted = true;

    return () => {
      mediaQuery.removeEventListener('change', handleThemeChange);
    };
  });

  // --- Merged Functions ---
  function updateTheme() {
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }

  function toggleTheme() {
    isDark = !isDark;
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
    updateTheme();
  }

  function applyAccent(accent) {
    document.documentElement.style.setProperty('--primary', accent.color);
    const r = parseInt(accent.color.slice(1, 3), 16);
    const g = parseInt(accent.color.slice(3, 5), 16);
    const b = parseInt(accent.color.slice(5, 7), 16);
    document.documentElement.style.setProperty('--glow-primary', `rgba(${r}, ${g}, ${b}, 0.4)`);
    document.documentElement.style.setProperty('--glow-accent', `rgba(${r}, ${g}, ${b}, 0.25)`);
    if (accent.id.includes('nord-1')) {
      document.documentElement.style.setProperty('--secondary', '#81A1C1');
      document.documentElement.style.setProperty('--accent', '#8FBCBB');
    } else {
      const secondaryColors = { 'nord-7': '#88C0D0', 'nord-8': '#81A1C1', 'nord-9': '#5E81AC', 'nord-10': '#8FBCBB' };
      const accentColors = { 'nord-7': '#81A1C1', 'nord-8': '#8FBCBB', 'nord-9': '#8FBCBB', 'nord-10': '#88C0D0' };
      document.documentElement.style.setProperty('--secondary', secondaryColors[accent.id] || '#81A1C1');
      document.documentElement.style.setProperty('--accent', accentColors[accent.id] || '#8FBCBB');
    }
    localStorage.setItem('accent-color', accent.id);
  }

  function selectAccent(accent) {
    currentAccent = accent;
    applyAccent(accent);
    isAccentPickerOpen = false;
  }

  function toggleFab() {
    if (isAccentPickerOpen) {
      isAccentPickerOpen = false;
    } else {
      isFabOpen = !isFabOpen;
    }
  }

  function openAccentPicker() {
    isAccentPickerOpen = true;
    isFabOpen = false;
  }
</script>

<div class="fab-container" class:open={isFabOpen}>
  <!-- Accent Picker Panel -->
  {#if isAccentPickerOpen}
    <div transition:fly={{ y: 20, duration: 250 }} class="accent-picker-panel">
      <h3 class="panel-title">Choose Accent Color</h3>
      <div class="color-grid">
        {#each accentOptions as option}
          <button
            on:click={() => selectAccent(option)}
            class="color-option"
            class:selected={currentAccent.id === option.id}
            style="background-color: {option.color};"
            title={option.name}
            aria-label={option.name}
          ></button>
        {/each}
      </div>
    </div>
  {/if}

  <!-- Secondary Action Buttons -->
  {#if isFabOpen}
    <button
      transition:fly={{ y: 20, duration: 250 }}
      on:click={openAccentPicker}
      class="fab-button secondary"
      style="transform: translateY(-120%);"
      aria-label="Choose accent color"
      title="Choose accent color"
    >
      <i class="fas fa-palette"></i>
    </button>
    <button
      transition:fly={{ y: 20, duration: 250 }}
      on:click={toggleTheme}
      class="fab-button secondary"
      style="transform: translateY(-60%);"
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {#if isDark}
        <i class="fas fa-sun"></i>
      {:else}
        <i class="fas fa-moon"></i>
      {/if}
    </button>
  {/if}

  <!-- Main FAB Button -->
  <button on:click={toggleFab} class="fab-button main" aria-label="Open settings">
    {#if mounted}
      <i class="fas fa-cog transition-transform duration-300" class:rotate-45={isFabOpen}></i>
    {:else}
      <div class="w-6 h-6 bg-current opacity-20 rounded-full animate-pulse"></div>
    {/if}
  </button>
</div>

<style>
  .fab-container {
    position: fixed;
    bottom: 1rem;
    right: 1rem;
    z-index: 1000;
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .fab-button {
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    border: 2px solid var(--primary);
    color: var(--primary);
    background-color: var(--card-bg);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    cursor: pointer;
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
  }
  .fab-button:hover {
    background-color: var(--primary);
    color: var(--background);
    transform: scale(1.1);
    box-shadow: 0 8px 25px var(--glow-primary);
  }
  .fab-button:focus {
    outline: none;
    box-shadow: 0 0 0 3px var(--primary);
  }

  .main {
    width: 56px;
    height: 56px;
    font-size: 1.5rem;
    position: relative;
    z-index: 2;
  }

  .secondary {
    position: absolute;
    bottom: 0;
    width: 48px;
    height: 48px;
    font-size: 1.25rem;
    z-index: 1;
  }

  .rotate-45 {
    transform: rotate(45deg);
  }

  .accent-picker-panel {
    position: absolute;
    bottom: calc(100% + 1rem);
    right: 0;
    width: 240px;
    background-color: var(--card-bg);
    border: 2px solid var(--border);
    border-radius: 1rem;
    padding: 1rem;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    z-index: 3;
  }

  .panel-title {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--text);
    margin-bottom: 0.75rem;
    text-align: center;
  }

  .color-grid {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 0.5rem;
  }

  .color-option {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    border: 2px solid transparent;
    cursor: pointer;
    transition: all 0.2s ease;
    position: relative;
  }
  .color-option:hover {
    transform: scale(1.1);
  }
  .color-option.selected {
    border-color: var(--text);
    box-shadow: 0 0 0 2px var(--card-bg);
  }
  .color-option.selected::after {
    content: '✓';
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    color: white;
    font-weight: bold;
    text-shadow: 0 1px 2px rgba(0,0,0,0.5);
  }
</style> 