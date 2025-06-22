/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  darkMode: 'selector', // Enable dark mode with .dark class
  theme: {
    extend: {
      colors: {
        // Semantic color mapping
        'background': 'var(--background)',
        'text': 'var(--text)',
        'primary': 'var(--primary)',
        'secondary': 'var(--secondary)',
        'accent': 'var(--accent)',
        'card-bg': 'var(--card-bg)',
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