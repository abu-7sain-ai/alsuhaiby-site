import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import editPlugin from './scripts/lib/edit-plugin.js';

// /review/ is an internal page: it exists in `npm run dev` only and is removed from every production build.
const dropReview = {
  name: 'drop-review-page',
  hooks: {
    'astro:build:done': ({ dir }) => {
      fs.rmSync(fileURLToPath(new URL('review/', dir)), { recursive: true, force: true }); // dist/review/index.html
    },
  },
};

export default defineConfig({
  site: 'https://alsuhaiby.com',
  trailingSlash: 'always',
  integrations: [
    // hreflang alternates live in each page's <head> (translated slugs differ per language).
    sitemap({ filter: (page) => !page.includes('/review/') && !page.includes('/404') }),
    dropReview,
  ],
  build: { inlineStylesheets: 'always' },
  // «تعديل» on /review/: load/save endpoints that exist only in `npm run dev`.
  vite: { plugins: [editPlugin()] },
});
