import { SITE } from '../i18n';
// Search engines and AI crawlers are explicitly allowed (constitution section 4).
const bots = ['Googlebot', 'Bingbot', 'GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-SearchBot', 'Google-Extended', 'PerplexityBot'];
export function GET() {
  const body = [
    ...bots.flatMap((b) => [`User-agent: ${b}`, 'Allow: /', 'Disallow: /review/', '']),
    'User-agent: *', 'Allow: /', 'Disallow: /review/', '',
    `Sitemap: ${SITE}/sitemap-index.xml`, '',
  ].join('\n');
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
