import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import editPlugin from './scripts/lib/edit-plugin.js';

export default defineConfig({
  site: 'https://alsuhaiby.com',
  trailingSlash: 'always',
  integrations: [
    // hreflang alternates live in each page's <head> (translated slugs differ per language).
    sitemap({ filter: (page) => !page.includes('/review/') }),
  ],
  build: { inlineStylesheets: 'always' },
  // «تعديل» on /review/: load/save endpoints that exist only in `npm run dev`.
  vite: { plugins: [editPlugin()] },
});
