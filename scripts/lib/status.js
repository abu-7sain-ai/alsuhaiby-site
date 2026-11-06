// status.js — data/status.json (the "dashboard" the advisor reads in Claude chat) + Telegram alerts.
//   guard('<script>')   call once at the top of a pipeline script: records the run, alerts ⚠️ on failure, refreshes status on success.
//   alert(text)         one-way Telegram message to «مجموعة التنبيهات» (scripts/lib/telegram.py); never throws.
//   refreshStatus()     recomputes every field (pages, videos, spend, key credit, site health) and alerts ⚠️ if credit < $3.
//   alertCatchUp(when)  the 02:00 daily run did not happen; the 05:00 check ran the catch-up.
//   node scripts/lib/status.js [--test-alert]   refresh now (and optionally send a test ✅)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ROOT, LIB_DIR, readJson, writeJson, apiKey } from './common.js';

const FILE = path.join(ROOT, 'data', 'status.json');
const SITE_URL = 'https://alsuhaiby.com/';
const CREDIT_ALERT_USD = 3;
const load = () => readJson(FILE, { errors: [] });

export function alert(text) {
  try {
    const r = spawnSync(process.env.PYTHON || 'python', ['-X', 'utf8', path.join(ROOT, 'scripts', 'lib', 'telegram.py'), text], { encoding: 'utf8', timeout: 30000 });
    if (r.status !== 0) console.warn(`  ! ${String(r.stderr || r.error || 'telegram failed').trim()}`);
    return r.status === 0;
  } catch (e) {
    console.warn(`  ! telegram: ${e.message}`);
    return false;
  }
}

function save(s) {
  s.updatedAt = new Date().toISOString();
  writeJson(FILE, s);
}

export function recordRun(script, ok, error) {
  const s = load();
  const at = new Date().toISOString();
  s.lastRun = { script, at, ok };
  if (!ok) s.errors = [{ at, script, error: String(error).slice(0, 500) }, ...(s.errors || [])].slice(0, 10);
  save(s);
}

async function keyCredit() {
  try {
    const H = { Authorization: `Bearer ${apiKey()}` };
    const k = (await (await fetch('https://openrouter.ai/api/v1/key', { headers: H })).json()).data || {};
    if (k.limit_remaining != null) return { usd: Math.round(k.limit_remaining * 100) / 100, source: 'key limit' };
    const c = (await (await fetch('https://openrouter.ai/api/v1/credits', { headers: H })).json()).data || {};
    return { usd: Math.round((c.total_credits - c.total_usage) * 100) / 100, source: 'account credit' };
  } catch (e) {
    return { usd: null, error: e.message };
  }
}

async function siteHealth() {
  const t0 = Date.now();
  try {
    const r = await fetch(SITE_URL, { redirect: 'follow', signal: AbortSignal.timeout(15000) });
    return { at: new Date().toISOString(), url: SITE_URL, httpStatus: r.status, ms: Date.now() - t0, up: r.ok };
  } catch (e) {
    return { at: new Date().toISOString(), url: SITE_URL, up: false, error: e.message };
  }
}

// Daily publish: GitHub Actions at 23:00 UTC = 02:00 Kuwait (.github/workflows/daily.yml).
function nextRun() {
  const n = new Date(); const t = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate(), 23, 0));
  if (t <= n) t.setUTCDate(t.getUTCDate() + 1);
  const k = new Date(t.getTime() + 3 * 3600e3);
  return `${k.toISOString().slice(0, 10)} 02:00 Kuwait (GitHub Actions, daily)`;
}
function archiveLeft() {
  const lib = readJson(path.join(LIB_DIR, 'library.json'), null), led = readJson(path.join(LIB_DIR, 'ledger.json'), null);
  if (!lib || !led) return undefined;
  return lib.videos.filter((v) => !['published', 'queued', 'merged', 'skipped'].includes(led[v.id]?.status)).length;
}

export async function refreshStatus() {
  const s = load();
  const pages = {};
  const cdir = path.join(ROOT, 'content', 'videos');
  for (const lang of fs.existsSync(cdir) ? fs.readdirSync(cdir) : []) pages[lang] = fs.readdirSync(path.join(cdir, lang)).filter((f) => f.endsWith('.md')).length;
  const spend = readJson(path.join(ROOT, 'data', 'spend.json'), { totalUsd: 0, calls: [] });
  const since = Date.now() - 30 * 864e5;
  const last30 = (spend.calls || []).filter((c) => Date.parse(c.at) >= since).reduce((a, c) => a + (c.costUsd || 0), 0);
  Object.assign(s, {
    nextScheduledRun: nextRun(),
    queueWaiting: fs.existsSync(path.join(ROOT, 'queue')) ? fs.readdirSync(path.join(ROOT, 'queue')).filter((d) => fs.existsSync(path.join(ROOT, 'queue', d, 'meta.json'))).length : 0,
    publishPerDay: readJson(path.join(ROOT, 'config', 'site.json'), {}).publishPerDay ?? 7,
    pagesPublished: { total: Object.values(pages).reduce((a, b) => a + b, 0), byLang: pages },
    videosAnalyzed: fs.existsSync(path.join(LIB_DIR, 'videos')) ? fs.readdirSync(path.join(LIB_DIR, 'videos')).filter((d) => fs.existsSync(path.join(LIB_DIR, 'videos', d, 'analysis.json'))).length : undefined,
    archiveLeft: archiveLeft(),
    videosOnR2: Object.keys(readJson(path.join(ROOT, 'data', 'r2.json'), {})).length,
    openRouterSpendUsd: { total: Math.round(spend.totalUsd * 1000) / 1000, last30Days: Math.round(last30 * 1000) / 1000 },
    keyCreditLeftUsd: await keyCredit(),
    siteHealth: await siteHealth(),
  });
  const credit = s.keyCreditLeftUsd.usd;
  s.alerts = s.alerts || {};
  if (credit != null && credit < CREDIT_ALERT_USD && Date.now() - Date.parse(s.alerts.lowCredit || 0) > 864e5) {
    if (alert(`⚠️ alsuhaiby.com: رصيد مفتاح OpenRouter قل عن ${CREDIT_ALERT_USD}$ (باقي ${credit}$). ارفع الحد قبل التشغيل الجاي.`)) s.alerts.lowCredit = new Date().toISOString();
  }
  save(s);
  return s;
}

export function alertCatchUp(missedAt) {
  alert(`⚠️ alsuhaiby.com: تشغيل النشر اليومي (${missedAt}) ما اشتغل — تم تشغيل التعويض الحين.`);
}

let guarded = false;
export function guard(script) {
  if (guarded) return;
  guarded = true;
  let failed = false;
  const fail = (e) => {
    if (failed) return;
    failed = true;
    const msg = e?.message || String(e);
    console.error(e);
    recordRun(script, false, msg);
    alert(`⚠️ alsuhaiby.com: فشل ${script}\n${msg.slice(0, 300)}`);
    process.exit(1);
  };
  process.on('uncaughtException', fail);
  process.on('unhandledRejection', fail);
  let done = false;
  process.on('beforeExit', async () => {
    if (done || failed) return;
    done = true;
    recordRun(script, true);
    await refreshStatus();
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const s = await refreshStatus();
  console.log(JSON.stringify(s, null, 2));
  if (process.argv.includes('--test-alert')) console.log('test alert sent:', alert('✅ alsuhaiby.com: تجربة — تنبيهات الموقع توصل لهالقروب.'));
}
