// Shared helpers for analyze.js / write.js / build-page.js. No external dependencies.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync, spawn } from 'node:child_process';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// One parent folder (2026-11-10): <parent>alsuhaiby-site, <parent>alsuhaiby-library, <parent>media{downloads,telegram-export}.
// PARENT = the folder that holds this repo. The old places (Desktop, Videos) are still found until the move is done.
export const PARENT = path.dirname(ROOT);
const firstThere = (...ps) => ps.find((p) => fs.existsSync(p)) || ps[0];
// Owner 2026-11-13: the repos stay on C: (SSD) in <Desktop>\alsuhaiby\; the rarely-read Telegram export lives on D:\alsuhaiby\telegram-export.
// Each place is tried in turn, so the code works before, during and after the move.
export const VIDEO_DIR = process.env.VIDEO_DIR || firstThere(path.join('D:\\', 'alsuhaiby', 'telegram-export', 'video_files'), path.join(PARENT, 'media', 'telegram-export', 'video_files'), path.join(os.homedir(), 'Videos', 'ChatExport_2026-10-30', 'video_files'));
export const EXPORT_DIR = path.dirname(VIDEO_DIR);
// Private library repo (abu-7sain-ai/alsuhaiby-library): transcripts, analyses, articles, review logs, dedup ledger. Never public.
export const LIB_DIR = process.env.LIB_DIR || path.join(PARENT, 'alsuhaiby-library'); // next to this repo, never inside it (it is private)
export const LIBRARY = process.env.LIBRARY_JSON || path.join(LIB_DIR, 'library.json');
// Videos fetched with yt-dlp (never committed; the copy everyone plays is on R2).
export const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR || firstThere(path.join(PARENT, 'media', 'downloads'), path.join(os.homedir(), 'Videos', 'alsuhaiby-downloads')); // (the old Videos copy is deleted by the move; new downloads are created in <parent>\media\downloads on demand)
export const OLD_ANALYSES = process.env.OLD_ANALYSES || path.join(os.homedir(), 'Desktop', 'KatibSuhaibi', 'data', 'files', 'بيانات-الحساب-والفيديوهات.txt');
export const MODEL = process.env.OPENROUTER_MODEL || 'google/gemini-3.8-flash';
export const LANGS = ['ar', 'en', 'fr', 'es', 'ur'];

export const readJson = (p, fallback) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : fallback);
// Every file is written whole or not at all (owner, 2026-11-11): write a temp file next to it, then rename over it.
export function writeFileAtomic(p, text) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  fs.writeFileSync(tmp, text, 'utf8');
  for (let i = 0; ; i++) {
    try { fs.renameSync(tmp, p); return; } catch (e) { // Windows: a reader (git, antivirus) can hold the old file for a moment
      if (i >= 20 || !['EPERM', 'EACCES', 'EBUSY'].includes(e.code)) { try { fs.rmSync(tmp, { force: true }); } catch {} throw e; }
      sleepSync(50);
    }
  }
}
export const writeJson = (p, data) => writeFileAtomic(p, JSON.stringify(data, null, 2) + '\n');

// ---- single-writer locks (owner, 2026-11-11) --------------------------------------------------------------------------
// One lock per shared resource: ledger, spend, run-state, queue, git-<repo>. A lock is a folder created with mkdir (atomic on
// every OS), so it also holds between separate processes (fetch / numbers / comments runs on the same PC). Inside one Node
// process the writers are synchronous, so two workers can never interleave inside a write; the lock covers other processes.
// A lock older than 10 minutes is treated as left over from a killed process and taken over.
export const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const LOCK_DIR = path.join(os.tmpdir(), 'alsuhaiby-locks');
export const lockStats = {}; // name → { taken, waited, waitMs, maxWaitMs, stale }
export function withLock(name, fn) {
  fs.mkdirSync(LOCK_DIR, { recursive: true });
  const dir = path.join(LOCK_DIR, name), st = (lockStats[name] ||= { taken: 0, waited: 0, waitMs: 0, maxWaitMs: 0, stale: 0 });
  const t0 = Date.now();
  for (;;) {
    try { fs.mkdirSync(dir); try { fs.writeFileSync(path.join(dir, 'pid'), String(process.pid)); } catch {} break; } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      // the owner is gone (killed process): take the lock over at once instead of waiting
      try { const owner = Number(fs.readFileSync(path.join(dir, 'pid'), 'utf8')); if (owner && owner !== process.pid) { let alive = true; try { process.kill(owner, 0); } catch (k) { alive = k.code === 'EPERM'; } if (!alive) { fs.rmSync(dir, { recursive: true, force: true }); st.stale++; continue; } } } catch {}
      try { if (Date.now() - fs.statSync(dir).mtimeMs > 10 * 60e3) { fs.rmSync(dir, { recursive: true, force: true }); st.stale++; continue; } } catch { continue; }
      if (Date.now() - t0 > 5 * 60e3) throw new Error(`lock ${name}: still held after 5 min`);
      sleepSync(25);
    }
  }
  const w = Date.now() - t0;
  st.taken++; if (w > 0) { st.waited++; st.waitMs += w; st.maxWaitMs = Math.max(st.maxWaitMs, w); }
  try { return fn(); } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} }
}

export function args() {
  const out = { _: [] };
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith('--') && a[i].includes('=')) {
      const [k, ...v] = a[i].slice(2).split('=');
      out[k] = v.join('=');
    } else if (a[i].startsWith('--')) {
      const k = a[i].slice(2);
      if (a[i + 1] && !a[i + 1].startsWith('--')) out[k] = a[++i];
      else out[k] = true;
    } else out._.push(a[i]);
  }
  return out;
}

// Reads OPENROUTER_API_KEY from .env (never printed, never written anywhere else).
export function apiKey() {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  const envFile = path.join(ROOT, '.env');
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*OPENROUTER_API_KEY\s*=\s*(.+?)\s*$/);
      if (m && m[1]) return m[1].replace(/^['"]|['"]$/g, '');
    }
  }
  throw new Error('OPENROUTER_API_KEY is missing in .env');
}

/** Every video we know about: id → { id, file, path, views, date, caption }. */
export function videoIndex() {
  const lib = readJson(LIBRARY, { videos: [] });
  const map = readJson(path.join(EXPORT_DIR, 'map.json'), []);
  const byId = new Map();
  for (const v of lib.videos) byId.set(v.id, { id: v.id, views: Math.round(v.views || 0), date: v.date, caption: v.cap || '' });
  // Files: map.json entries that name exactly one TikTok id, plus files downloaded later as tk_<id>.mp4.
  for (const m of map) {
    if (!m.file.startsWith('5889539663_tk') || m.ids.length !== 1) continue;
    const v = byId.get(m.ids[0]);
    if (v && !v.file) Object.assign(v, { file: m.file, path: path.join(VIDEO_DIR, m.file) });
  }
  if (fs.existsSync(VIDEO_DIR)) {
    for (const f of fs.readdirSync(VIDEO_DIR)) {
      const m = f.match(/^tk_(\d+)\.mp4$/);
      if (m && byId.has(m[1]) && !byId.get(m[1]).file) Object.assign(byId.get(m[1]), { file: f, path: path.join(VIDEO_DIR, f) });
    }
  }
  if (fs.existsSync(DOWNLOAD_DIR)) {
    for (const f of fs.readdirSync(DOWNLOAD_DIR)) {
      const m = f.match(/^(\d+)\.mp4$/);
      if (m && byId.has(m[1]) && !byId.get(m[1]).file) Object.assign(byId.get(m[1]), { file: f, path: path.join(DOWNLOAD_DIR, f) });
    }
  }
  return byId;
}

/** Cache files live in the private library repo (videos/<id>/<kind>.json) so nothing is paid for twice. */
export const cachePath = (video, kind) => path.join(LIB_DIR, 'videos', String(video.id ?? video), `${kind}.json`);

// ---- dedup ledger (private library): id → { status, page, reason, line, at } ---------------------
// status: published | queued | merged | skipped | download-failed. Remaining = library − ledger (published/queued/merged/skipped).
export const LEDGER = path.join(LIB_DIR, 'ledger.json');
export const DONE = new Set(['published', 'queued', 'merged', 'skipped', 'excluded', 'merge-held', 'held-length', 'deferred']); // deferred = «معلّقة»: stalled or failed once, set aside for a human (step + reason in the ledger), never retried automatically // held-length = final article outside 1150–1400 after every pass, kept in the library for a human look, never queued // excluded = never published (owner's rule: incomplete data) · merge-held = duplicate of a live page, embed waits for the publishing side
export const loadLedger = () => readJson(LEDGER, {});
export function setLedger(id, entry) {
  return withLock('ledger', () => {
    const l = loadLedger();
    l[id] = { ...(l[id] || {}), ...entry, at: new Date().toISOString() };
    writeJson(LEDGER, l);
    return l[id];
  });
}

/** Kuwait date (YYYY-MM-DD) — the site's day. */
export const kuwaitDay = (d = new Date()) => new Date(d.getTime() + 3 * 3600e3).toISOString().slice(0, 10);

// ---- spend tracking -------------------------------------------------------
const SPEND = path.join(ROOT, 'data', 'spend.json');
export function recordSpend(entry) {
  return withLock('spend', () => {
    const s = readJson(SPEND, { totalUsd: 0, calls: [] });
    s.calls.push({ at: new Date().toISOString(), ...entry });
    s.totalUsd = Math.round(s.calls.reduce((a, c) => a + (c.costUsd || 0), 0) * 1e6) / 1e6;
    writeJson(SPEND, s);
    return s.totalUsd;
  });
}

// ---- OpenRouter -----------------------------------------------------------
export class ClaudeLimitError extends Error {}
// A run that is stopping (time limit / Claude limit) ends its open Claude calls; the videos they belonged to are discarded.
export class StopError extends Error {}
export const runFlags = { stopping: false, aborted: new Set() }; // aborted = video ids cut off by the 15-minute cap
// NEVER WAIT (owner, 2026-11-11): a video that stalls, asks for input or fails is set aside at once — no retry.
export class SkipError extends Error { constructor(msg, step) { super(msg); this.step = step; } }
const abortedLabel = (label) => [...runFlags.aborted].some((id) => String(label).includes(id));

// Claude Code CLI on his PC (his subscription, no per-call cost). Lean call: own system prompt, no tools, no MCP,
// no user settings (so the Telegram Stop hook does not fire per call), no saved session.
export const liveChildren = new Map(); // running claude process → its label (killed on a limit / time stop, or for one video at its cap)
const killTree = (c) => { try { spawnSync('taskkill', ['/pid', String(c.pid), '/t', '/f'], { stdio: 'ignore' }); } catch {} try { c.kill(); } catch {} };
export function killFor(id) { for (const [c, label] of liveChildren) if (String(label).includes(id)) killTree(c); }
export function killChildren() { for (const c of liveChildren.keys()) { try { spawnSync('taskkill', ['/pid', String(c.pid), '/t', '/f'], { stdio: 'ignore' }); } catch {} try { c.kill(); } catch {} } }
async function claudeCli({ messages, script, label }) {
  const sys = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const conv = messages.filter((m) => m.role !== 'system')
    .map((m) => (m.role === 'assistant' ? `YOUR PREVIOUS ANSWER:\n${m.content}` : typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n\n');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alsuhaiby-claude-'));
  const sp = path.join(dir, 'system.txt');
  fs.writeFileSync(sp, sys || 'You return JSON only.', 'utf8');
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY; // always the subscription, never an API key
  const t0 = Date.now();
  const r = await new Promise((resolve) => {
    const c = spawn('claude', ['-p', '--output-format', 'json', '--setting-sources', 'project', '--no-session-persistence', '--model', process.env.CLAUDE_MODEL || 'opus',
      '--tools', '""', '--strict-mcp-config', '--system-prompt-file', `"${sp}"`], { cwd: dir, env, shell: true, windowsHide: true });
    liveChildren.set(c, label);
    let stdout = '', stderr = '', waiting = '';
    c.stdout.setEncoding('utf8').on('data', (d) => { stdout += d; });
    // a call that asks for a login / input / confirmation is ended at once (it can never answer: nobody is at the keyboard)
    c.stderr.setEncoding('utf8').on('data', (d) => { stderr += d; if (!waiting && /log ?in|authenticat|press (enter|any key)|\(y\/n\)|confirm|enter your/i.test(d)) { waiting = d.trim().slice(0, 120); killTree(c); } });
    const timer = setTimeout(() => killTree(c), 10 * 60e3); // one Claude call normally takes < 2 min; 10 min = stuck
    c.on('error', (error) => { clearTimeout(timer); liveChildren.delete(c); resolve({ stdout, stderr, error, waiting }); });
    c.on('close', (status) => { clearTimeout(timer); liveChildren.delete(c); resolve({ stdout, stderr, status, waiting }); });
    c.stdin.end(`${conv}\n\nReturn ONLY the JSON object.`, 'utf8');
  });
  fs.rmSync(dir, { recursive: true, force: true });
  if (runFlags.stopping) throw new StopError(`stopped during ${label}`);
  if (abortedLabel(label)) throw new SkipError(`15-minute cap reached during ${label}`, label);
  if (r.waiting) throw new SkipError(`Claude asked for input/login (${r.waiting}) during ${label}`, label);
  let j;
  try { j = JSON.parse(r.stdout); } catch {
    const raw = String(r.stderr || r.stdout || r.error || '');
    if (/usage limit|limit reached|hit your limit|rate.?limit|quota|429/i.test(raw)) throw new ClaudeLimitError(`Claude subscription limit: ${raw.slice(0, 200)}`);
    throw new Error(`claude CLI: ${raw.slice(0, 300)}`);
  }
  if (j.is_error) {
    const msg = String(j.result || j.api_error_status || 'error');
    if (/limit|usage|quota|rate|429/i.test(msg)) throw new ClaudeLimitError(`Claude subscription limit: ${msg.slice(0, 200)}`);
    throw new Error(`claude CLI: ${msg.slice(0, 300)}`);
  }
  const u = j.usage || {};
  recordSpend({ script, label, model: 'claude-cli (subscription)', promptTokens: u.input_tokens, completionTokens: u.output_tokens, costUsd: 0, subscriptionUsdEquivalent: j.total_cost_usd });
  console.log(`  · ${label}: claude (subscription) · ${u.output_tokens ?? '?'} out · ${Math.round((Date.now() - t0) / 1000)} s`);
  return j.result;
}

export async function chat({ messages, script, label, json = true, model = MODEL, maxTokens = 12000, temperature = 0.6 }) {
  // fetch.js (download-only) sets this: any AI call there is a bug, never a cost (no Claude subscription, no Gemini)
  if (process.env.ALSUHAIBY_NO_AI === '1') throw new Error(`AI call blocked in a download-only run (${label})`);
  if (model === 'claude-cli') {
    let lastErr;
    for (let attempt = 1; attempt <= 1; attempt++) { // NEVER WAIT: no retry
      if (runFlags.stopping) throw new StopError(`stopped before ${label}`);
      if (abortedLabel(label)) throw new SkipError(`15-minute cap reached before ${label}`, label);
      try {
        const text = await claudeCli({ messages, script, label });
        return json ? parseJson(text) : text;
      } catch (e) {
        if (e instanceof ClaudeLimitError || e instanceof StopError || e instanceof SkipError) throw e;
        lastErr = e;
        console.warn(`  ! attempt ${attempt} failed: ${e.message}`);
      }
    }
    throw lastErr;
  }
  const body = { model, messages, max_tokens: maxTokens, temperature, usage: { include: true } };
  if (json) body.response_format = { type: 'json_object' };
  let lastErr;
  for (let attempt = 1; attempt <= 1; attempt++) { // NEVER WAIT: no retry; 3-minute cap on the request
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', { signal: AbortSignal.timeout(3 * 60e3),
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey()}`, 'Content-Type': 'application/json', 'X-Title': 'alsuhaiby-site' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(`OpenRouter ${res.status}: ${JSON.stringify(data.error || data).slice(0, 400)}`);
      const u = data.usage || {};
      const total = recordSpend({ script, label, model: data.model || model, promptTokens: u.prompt_tokens, completionTokens: u.completion_tokens, costUsd: u.cost ?? 0 });
      const text = data.choices?.[0]?.message?.content ?? '';
      console.log(`  · ${label}: ${u.prompt_tokens ?? '?'} in / ${u.completion_tokens ?? '?'} out · $${(u.cost ?? 0).toFixed(4)} · running total $${total.toFixed(4)}`);
      return json ? parseJson(text) : text;
    } catch (e) {
      lastErr = e;
      console.warn(`  ! attempt ${attempt} failed: ${e.message}`);
    }
  }
  throw lastErr;
}

export function parseJson(text) {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try { return JSON.parse(t); } catch {
    const s = t.indexOf('{'), e = t.lastIndexOf('}');
    return JSON.parse(t.slice(s, e + 1));
  }
}

export const wordCount = (s) => (s.match(/[\p{L}\p{N}]+/gu) || []).length;
