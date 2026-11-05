import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://alsuhaiby.com',
  trailingSlash: 'always',
  integrations: [
    // hreflang alternates live in each page's <head> (translated slugs differ per language).
    sitemap({ filter: (page) => !page.includes('/review/') }),
  ],
  build: { inlineStylesheets: 'always' },
});
