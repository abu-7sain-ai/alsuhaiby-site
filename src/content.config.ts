import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { glob } from 'astro/loaders';

// One Markdown file per video topic per language: content/videos/<lang>/<slug>.md
const videos = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './content/videos' }),
  schema: z.object({
    lang: z.enum(['ar', 'en', 'fr', 'es', 'ur']),
    topic: z.string(), // language-independent key shared by all translations (hreflang)
    slug: z.string(),
    title: z.string(),
    summary: z.string(),
    description: z.string(),
    published: z.coerce.date(),
    updated: z.coerce.date(),
    views: z.number(),
    cover: z.string(),
    ogImage: z.string(),
    platforms: z.object({
      tiktok: z.string(),
      instagram: z.string().optional(),
      youtube: z.string().optional(),
    }),
    tiktokId: z.string(),
    duration: z.number().optional(),
    otherVideos: z
      .array(z.object({ tiktokId: z.string(), title: z.string(), views: z.number(), published: z.coerce.date(), cover: z.string() }))
      .default([]),
    tags: z.array(z.string()).default([]),
    system: z.string(),
    brands: z.array(z.string()).default([]),
    keywords: z.array(z.string()).min(3).max(5),
    faq: z.array(z.object({ q: z.string(), a: z.string() })).default([]),
  }),
});

export const collections = { videos };
