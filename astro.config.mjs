// astro.config.mjs
import { defineConfig } from 'astro/config';

import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import svelte from '@astrojs/svelte';

export default defineConfig({
  site: 'https://danielhkuo.github.io',

  integrations: [mdx(), sitemap(), svelte()],
});