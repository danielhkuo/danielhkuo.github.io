<script>
  import { onMount } from 'svelte';
  
  let isOpen = false;
  let mounted = false;
  
  // Available accent colors from Nord Frost and Aurora
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
  
  onMount(() => {
    // Load saved accent preference
    const saved = localStorage.getItem('accent-color');
    if (saved) {
      const savedAccent = accentOptions.find(option => option.id === saved);
      if (savedAccent) {
        currentAccent = savedAccent;
        applyAccent(currentAccent);
      }
    } else {
      // Apply default accent on first load
      applyAccent(currentAccent);
    }
    mounted = true;
  });
  
  function applyAccent(accent) {
    // Update primary accent color
    document.documentElement.style.setProperty('--primary', accent.color);
    
    // Update glow colors based on the accent
    const r = parseInt(accent.color.slice(1, 3), 16);
    const g = parseInt(accent.color.slice(3, 5), 16);
    const b = parseInt(accent.color.slice(5, 7), 16);
    
    document.documentElement.style.setProperty('--glow-primary', `rgba(${r}, ${g}, ${b}, 0.4)`);
    document.documentElement.style.setProperty('--glow-accent', `rgba(${r}, ${g}, ${b}, 0.25)`);
    
    // Update supporting colors based on accent family
    if (accent.id.includes('nord-1')) { // Aurora colors
      // For Aurora colors, keep frost as supporting colors
      document.documentElement.style.setProperty('--secondary', '#81A1C1'); // nord9
      document.documentElement.style.setProperty('--accent', '#8FBCBB'); // nord7
    } else { // Frost colors
      // For Frost colors, use different frost shades as supporting
      const secondaryColors = {
        'nord-7': '#88C0D0', // nord8
        'nord-8': '#81A1C1', // nord9
        'nord-9': '#5E81AC', // nord10
        'nord-10': '#8FBCBB' // nord7
      };
      const accentColors = {
        'nord-7': '#81A1C1', // nord9
        'nord-8': '#8FBCBB', // nord7
        'nord-9': '#8FBCBB', // nord7
        'nord-10': '#88C0D0' // nord8
      };
      
      document.documentElement.style.setProperty('--secondary', secondaryColors[accent.id] || '#81A1C1');
      document.documentElement.style.setProperty('--accent', accentColors[accent.id] || '#8FBCBB');
    }
    
    // Save preference
    localStorage.setItem('accent-color', accent.id);
  }
  
  function selectAccent(accent) {
    currentAccent = accent;
    applyAccent(accent);
    isOpen = false;
  }
  
  function togglePicker() {
    isOpen = !isOpen;
  }
</script>

<!-- Accent Picker Button -->
<div class="accent-picker-container">
  <button
    on:click={togglePicker}
    class="accent-picker-button fixed top-4 left-4 z-50 p-3 rounded-full bg-card-bg border-2 border-primary text-primary hover:bg-primary hover:text-background transition-all duration-300 shadow-lg hover:shadow-xl transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background"
    aria-label="Choose accent color"
    title="Choose accent color"
  >
    {#if mounted}
      <!-- Color swatch icon -->
      <svg class="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
        <path d="M12 2c5.514 0 10 4.486 10 10s-4.486 10-10 10-10-4.486-10-10 4.486-10 10-10zm0-2c-6.627 0-12 5.373-12 12 0 6.627 5.373 12 12 12s12-5.373 12-12c0-6.627-5.373-12-12-12zm-1.25 17.292l-4.5-4.364 1.857-1.858 2.643 2.506 5.643-5.784 1.857 1.858-7.5 7.642z"/>
      </svg>
    {:else}
      <!-- Loading placeholder -->
      <div class="w-6 h-6 bg-current opacity-20 rounded animate-pulse"></div>
    {/if}
  </button>

  <!-- Color Picker Dropdown -->
  {#if isOpen}
    <div class="accent-picker-dropdown fixed top-16 left-4 z-50 bg-card-bg border-2 border-border rounded-2xl p-4 shadow-2xl max-w-xs">
      <h3 class="text-sm font-semibold text-text mb-3">Choose Accent Color</h3>
      <div class="grid grid-cols-3 gap-2">
        {#each accentOptions as option}
          <button
            on:click={() => selectAccent(option)}
            class="accent-option p-3 rounded-lg border-2 transition-all duration-200 hover:scale-105 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-card-bg"
            class:selected={currentAccent.id === option.id}
            style="background-color: {option.color}; border-color: {currentAccent.id === option.id ? option.color : 'transparent'};"
            title={option.name}
            aria-label={option.name}
          >
            <div class="w-6 h-6 rounded-full" style="background-color: {option.color};"></div>
          </button>
        {/each}
      </div>
      <div class="mt-3 text-xs text-text-secondary text-center">
        Current: {currentAccent.name}
      </div>
    </div>
  {/if}
</div>

<style>
  .accent-picker-button {
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
  }
  
  .accent-picker-dropdown {
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
  }
  
  .accent-option {
    position: relative;
  }
  
  .accent-option.selected::after {
    content: '✓';
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    color: white;
    font-weight: bold;
    text-shadow: 0 1px 2px rgba(0,0,0,0.5);
  }
  
  /* Ensure picker is accessible on all backgrounds */
  @media (prefers-reduced-motion: reduce) {
    .accent-picker-button,
    .accent-option {
      transition: none;
    }
  }
</style> 