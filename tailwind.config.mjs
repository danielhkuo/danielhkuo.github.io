/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  darkMode: 'selector', // Enable dark mode with .dark class
  theme: {
    extend: {
      colors: {
        // Nord Color Palette
        // Polar Night (Dark theme background colors)
        'nord0': '#2E3440',  // Background
        'nord1': '#3B4252',  // Card/Secondary background
        'nord2': '#434C5E',  // Secondary elements
        'nord3': '#4C566A',  // Comments/Disabled text
        
        // Snow Storm (Light theme background colors)
        'nord4': '#D8DEE9',  // Secondary text
        'nord5': '#E5E9F0',  // Card background (light)
        'nord6': '#ECEFF4',  // Primary background (light)
        
        // Frost (Blue accent colors)
        'nord7': '#8FBCBB',   // Accent/Cyan
        'nord8': '#88C0D0',   // Primary accent (light blue)
        'nord9': '#81A1C1',   // Secondary accent (blue)
        'nord10': '#5E81AC',  // Primary blue
        
        // Aurora (Additional accent colors)
        'nord11': '#BF616A',  // Red
        'nord12': '#D08770',  // Orange
        'nord13': '#EBCB8B',  // Yellow
        'nord14': '#A3BE8C',  // Green
        'nord15': '#B48EAD',  // Purple
        
        // Semantic color mapping
        'background': 'var(--background)',
        'text': 'var(--text)',
        'primary': 'var(--primary)',
        'secondary': 'var(--secondary)',
        'accent': 'var(--accent)',
        'card-bg': 'var(--card-bg)',
      },
      fontFamily: {
        'lato': ['Lato', 'sans-serif'],
        'fira': ['Fira Code', 'monospace'],
      },
      animation: {
        'scroll-right': 'scroll-right 30s linear infinite',
        'scroll-left': 'scroll-left 35s linear infinite',
      },
      keyframes: {
        'scroll-right': {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-50%)' },
        },
        'scroll-left': {
          '0%': { transform: 'translateX(-50%)' },
          '100%': { transform: 'translateX(0)' },
        },
      },
    },
  },
  plugins: [],
} 