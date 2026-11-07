// Shared helpers for analyze.js / write.js / build-page.js. No external dependencies.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const VIDEO_DIR = process.env.VIDEO_DIR || path.join(os.homedir(), 'Videos', 'ChatExport_2026-10-30', 'video_files');
export const EXPORT_DIR = path.dirname(VIDEO_DIR);
// Private library repo (abu-7sain-ai/alsuhaiby-library): transcripts, analyses, articles, review logs, dedup ledger. Never public.
export const LIB_DIR = process.env.LIB_DIR || path.join(os.homedir(), 'Desktop', 'alsuhaiby-library');
export const LIBRARY = process.env.LIBRARY_JSON || path.join(LIB_DIR, 'library.json');
// Videos fetched with yt-dlp (never committed; the copy everyone plays is on R2).
export const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR || path.join(os.homedir(), 'Videos', 'alsuhaiby-downloads');
export const OLD_ANALYSES = process.env.OLD_ANALYSES || path.join(os.homedir(), 'Desktop', 'KatibSuhaibi', 'data', 'files', 'بيانات-الحساب-والفيديوهات.txt');
export const MODEL = process.env.OPENROUTER_MODEL || 'google/gemini-3.8-flash';
export const LANGS = ['ar', 'en', 'fr', 'es', 'ur'];

export const readJson = (p, fallback) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : fallback);
export const writeJson = (p, data) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n', 'utf8');
};

export function args() {
  const out = { _: [] };
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith('--')) {
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
export const DONE = new Set(['published', 'queued', 'merged', 'skipped']);
export const loadLedger = () => readJson(LEDGER, {});
export function setLedger(id, entry) {
  const l = loadLedger();
  l[id] = { ...(l[id] || {}), ...entry, at: new Date().toISOString() };
  writeJson(LEDGER, l);
  return l[id];
}

/** Kuwait date (YYYY-MM-DD) — the site's day. */
export const kuwaitDay = (d = new Date()) => new Date(d.getTime() + 3 * 3600e3).toISOString().slice(0, 10);

// ---- spend tracking -------------------------------------------------------
const SPEND = path.join(ROOT, 'data', 'spend.json');
export function recordSpend(entry) {
  const s = readJson(SPEND, { totalUsd: 0, calls: [] });
  s.calls.push({ at: new Date().toISOString(), ...entry });
  s.totalUsd = Math.round(s.calls.reduce((a, c) => a + (c.costUsd || 0), 0) * 1e6) / 1e6;
  writeJson(SPEND, s);
  return s.totalUsd;
}

// ---- OpenRouter -----------------------------------------------------------
export class ClaudeLimitError extends Error {}

// Claude Code CLI on his PC (his subscription, no per-call cost). Lean call: own system prompt, no tools, no MCP,
// no user settings (so the Telegram Stop hook does not fire per call), no saved session.
function claudeCli({ messages, script, label }) {
  const sys = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const conv = messages.filter((m) => m.role !== 'system')
    .map((m) => (m.role === 'assistant' ? `YOUR PREVIOUS ANSWER:\n${m.content}` : typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n\n');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alsuhaiby-claude-'));
  const sp = path.join(dir, 'system.txt');
  fs.writeFileSync(sp, sys || 'You return JSON only.', 'utf8');
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY; // always the subscription, never an API key
  const t0 = Date.now();
  const r = spawnSync('claude', ['-p', '--output-format', 'json', '--setting-sources', 'project', '--no-session-persistence', '--model', process.env.CLAUDE_MODEL || 'opus',
    '--tools', '""', '--strict-mcp-config', '--system-prompt-file', `"${sp}"`], { input: `${conv}\n\nReturn ONLY the JSON object.`, cwd: dir, env, encoding: 'utf8', shell: true, timeout: 20 * 60e3, maxBuffer: 64 << 20 });
  fs.rmSync(dir, { recursive: true, force: true });
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
  if (model === 'claude-cli') {
    let lastErr;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const text = claudeCli({ messages, script, label });
        return json ? parseJson(text) : text;
      } catch (e) {
        if (e instanceof ClaudeLimitError) throw e;
        lastErr = e;
        console.warn(`  ! attempt ${attempt} failed: ${e.message}`);
      }
    }
    throw lastErr;
  }
  const body = { model, messages, max_tokens: maxTokens, temperature, usage: { include: true } };
  if (json) body.response_format = { type: 'json_object' };
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
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
      await new Promise((r) => setTimeout(r, 2000 * attempt));
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
