// astro.config.mjs
import { defineConfig } from 'astro/config';

import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import svelte from '@astrojs/svelte';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://danielhkuo.github.io',

  integrations: [mdx(), sitemap(), svelte()],
  
  vite: {
    plugins: [tailwindcss()],
  },
});