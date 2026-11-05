import { getCollection } from 'astro:content';

export async function GET() {
  const entries = await getCollection('videos', (e) => e.data.lang === 'ar');
  const items = entries.map((e) => ({
    slug: e.data.slug,
    title: e.data.title,
    summary: e.data.summary,
    cover: e.data.cover,
    views: e.data.views,
    text: [e.data.summary, ...e.data.keywords, ...e.data.tags, ...e.data.faq.map((f) => f.q), e.body?.replace(/[#*]/g, ' ') ?? ''].join(' '),
  }));
  return new Response(JSON.stringify(items), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
