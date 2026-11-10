// deploy-check.js — did the last push to main actually go live? (gap found 2026-11-10: Cloudflare build e14f8189
// for 642a6d2 failed and nothing alerted). Compares https://alsuhaiby.com/build.json (the commit the live site was
// built from) with main's HEAD on GitHub. Silent when they match. ⚠️ Telegram when the live site is still on an
// older commit more than 10 minutes after the push.
//   node scripts/deploy-check.js                      one check (the 05:37 run): alert if HEAD is >10 min old and not live
//   node scripts/deploy-check.js --watch <sha>        after a push: poll every 30 s until <sha> is live (silent) or
//                                                     10 min have passed since the push (alert). Stops quietly if a newer
//                                                     push replaced <sha> (that push's own check takes over).
//   --pushed-at <iso|epoch>   push time (the push workflow passes it; otherwise GitHub's repo pushed_at)
//   --dry-run                 print the alert instead of sending it
//   --test                    exercise the alert path: pretend the live site is stale and send a «🧪 اختبار» alert
import { alert } from './lib/status.js';
import { args } from './lib/common.js';

const A = args();
const REPO = 'abu-7sain-ai/alsuhaiby-site';
const SITE = process.env.SITE_URL || 'https://alsuhaiby.com';
const LIMIT_MIN = Number(A['limit-minutes'] || 10);
const gh = async (p) => {
  const h = { Accept: 'application/vnd.github+json', 'User-Agent': 'alsuhaiby-deploy-check' };
  if (process.env.GITHUB_TOKEN) h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const r = await fetch(`https://api.github.com/repos/${REPO}${p}`, { headers: h, signal: AbortSignal.timeout(20e3) });
  if (!r.ok) throw new Error(`GitHub ${p}: ${r.status}`);
  return r.json();
};
const kuwait = (d) => new Date(new Date(d).getTime() + 3 * 3600e3).toISOString().replace('T', ' ').slice(0, 16);
const toDate = (x) => (x == null || x === true ? null : /^\d+$/.test(String(x)) ? new Date(Number(x) * 1000) : new Date(x));

async function liveSha() {
  try {
    const r = await fetch(`${SITE}/build.json?v=${Date.now()}`, { headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(20e3) });
    if (!r.ok) return { sha: null, why: `build.json ${r.status}` };
    const j = await r.json();
    return { sha: j.sha, builtAt: j.builtAt };
  } catch (e) { return { sha: null, why: `site not reachable: ${e.message}` }; }
}
async function head() {
  const [c, repo] = await Promise.all([gh('/commits/main'), gh('')]);
  return { sha: c.sha, msg: c.commit.message.split('\n')[0], committedAt: c.commit.committer.date, pushedAt: repo.pushed_at };
}
async function cloudflareBuild(sha) {
  try {
    const r = (await gh(`/commits/${sha}/check-runs`)).check_runs.find((x) => /Workers Builds/i.test(x.name));
    return r ? `${r.status}${r.conclusion ? ' / ' + r.conclusion : ''} — ${r.details_url}` : 'no Cloudflare build reported for this commit';
  } catch { return 'unknown'; }
}
const isLive = (live, sha) => live.sha && live.sha === sha;

async function report(sha, msg, pushedAt, live) {
  const build = await cloudflareBuild(sha);
  const text = `${A.test ? '🧪 اختبار — ' : ''}⚠️ alsuhaiby.com: آخر تعديل ما وصل للموقع
commit:
${sha.slice(0, 7)} — ${msg.slice(0, 80)}
انرفع: ${kuwait(pushedAt)} (الكويت)، وبعد ${LIMIT_MIN} دقايق الموقع للحين على:
${live.sha ? live.sha.slice(0, 7) : live.why}
Cloudflare build:
${build}`;
  console.log(text);
  if (A['dry-run']) { console.log('(dry run: not sent)'); return; }
  if (!alert(text)) { console.error('Telegram alert NOT sent'); process.exitCode = 1; }
}

async function main() {
if (A.test) {
  const h = await head();
  await report(h.sha, h.msg, new Date(Date.now() - 11 * 60e3).toISOString(), { sha: '0000000 (test: pretend stale)' });
} else if (A.watch) {
  const sha = String(A.watch);
  const pushedAt = toDate(A['pushed-at']) || new Date();
  const deadline = pushedAt.getTime() + LIMIT_MIN * 60e3;
  let live;
  for (;;) {
    live = await liveSha();
    if (isLive(live, sha)) { console.log(`live on ${sha.slice(0, 7)} (built ${live.builtAt}) — ok`); return; }
    const h = await head().catch(() => null);
    if (h && h.sha !== sha) { console.log(`a newer push (${h.sha.slice(0, 7)}) replaced ${sha.slice(0, 7)} — its own check takes over`); return; }
    if (Date.now() >= deadline) break;
    console.log(`  live: ${live.sha ? live.sha.slice(0, 7) : live.why} · waiting for ${sha.slice(0, 7)}`);
    await new Promise((r) => setTimeout(r, Math.min(30e3, Math.max(1e3, deadline - Date.now()))));
  }
  const msg = (await gh(`/commits/${sha}`).catch(() => null))?.commit?.message?.split('\n')[0] || '';
  await report(sha, msg, pushedAt, live);
} else {
  const h = await head();
  const pushedAt = toDate(A['pushed-at']) || new Date(h.pushedAt || h.committedAt);
  const live = await liveSha();
  if (isLive(live, h.sha)) { console.log(`live on HEAD ${h.sha.slice(0, 7)} — ok`); return; }
  const ageMin = (Date.now() - pushedAt.getTime()) / 60e3;
  if (ageMin < LIMIT_MIN) { console.log(`HEAD ${h.sha.slice(0, 7)} pushed ${ageMin.toFixed(1)} min ago — too early to judge`); return; }
  await report(h.sha, h.msg, pushedAt, live);
}
}
await main();
