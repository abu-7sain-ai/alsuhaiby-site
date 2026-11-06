// edit-plugin.js — the «تعديل» button on /review/ (dev server only; it does not exist in the built site).
//   GET  /__edit/load?slug=<slug>   → { title, summary, body, faq: [{q, a}] } of content/videos/ar/<slug>.md
//   POST /__edit/save  { slug, title, summary, body, faq }
// Before every save the current file is copied to content/_history/<slug>/<timestamp>.md (nothing is ever lost).
// The saved page gets `manualEdit: <date>` so scripts/build-page.js never overwrites a hand-corrected page.
// After a save the dev server reloads the content by itself, and a production build (dist/) runs in the background.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const ROOT = process.cwd();
const AR_DIR = path.join(ROOT, 'content', 'videos', 'ar');
const HISTORY = path.join(ROOT, 'content', '_history');
const NL = String.fromCharCode(10);

function fileFor(slug) {
  const s = String(slug || '');
  if (!s || /[\\/]|\.\./.test(s)) return null; // a plain file name inside content/videos/ar only
  const f = path.join(AR_DIR, `${s}.md`);
  return fs.existsSync(f) ? f : null;
}

function split(text) {
  const t = text.replace(/\r/g, '');
  const end = t.indexOf(`${NL}---${NL}`, 3);
  if (!t.startsWith(`---${NL}`) || end < 0) throw new Error('no frontmatter');
  return { fm: t.slice(4, end).split(NL), body: t.slice(end + 5) };
}

const val = (fm, key) => {
  const line = fm.find((l) => l.startsWith(`${key}: `));
  return line ? JSON.parse(line.slice(key.length + 2)) : '';
};

function readFaq(fm) {
  const i = fm.findIndex((l) => /^faq:/.test(l));
  if (i < 0) return [];
  const out = [];
  for (const l of fm.slice(i + 1)) {
    if (/^\S/.test(l)) break; // next top-level key
    let m;
    if ((m = l.match(/^ {2}- q: (.*)$/))) out.push({ q: JSON.parse(m[1]), a: '' });
    else if ((m = l.match(/^ {4}a: (.*)$/)) && out.length) out[out.length - 1].a = JSON.parse(m[1]);
  }
  return out;
}

function load(slug) {
  const f = fileFor(slug);
  if (!f) throw new Error('page not found');
  const { fm, body } = split(fs.readFileSync(f, 'utf8'));
  return { slug, title: val(fm, 'title'), summary: val(fm, 'summary'), body: body.trim(), faq: readFaq(fm) };
}

function setLine(fm, key, value) {
  const line = `${key}: ${JSON.stringify(String(value))}`;
  const i = fm.findIndex((l) => l.startsWith(`${key}:`));
  if (i >= 0) fm[i] = line;
  else {
    const at = fm.findIndex((l) => /^faq:/.test(l));
    fm.splice(at < 0 ? fm.length : at, 0, line);
  }
}

function save(data) {
  const f = fileFor(data.slug);
  if (!f) throw new Error('page not found');
  const title = String(data.title || '').trim();
  const summary = String(data.summary || '').trim();
  const body = String(data.body || '').replace(/\r/g, '').trim();
  if (!title || !summary || !body) throw new Error('title, summary and body are required');
  const faq = (Array.isArray(data.faq) ? data.faq : [])
    .map((x) => ({ q: String(x.q || '').trim(), a: String(x.a || '').trim() }))
    .filter((x) => x.q && x.a);

  const old = fs.readFileSync(f, 'utf8');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const hist = path.join(HISTORY, data.slug);
  fs.mkdirSync(hist, { recursive: true });
  fs.writeFileSync(path.join(hist, `${stamp}.md`), old, 'utf8'); // previous version, kept forever

  const { fm } = split(old);
  const today = new Date().toISOString().slice(0, 10);
  setLine(fm, 'title', title);
  setLine(fm, 'summary', summary);
  setLine(fm, 'updated', today);
  setLine(fm, 'manualEdit', today);
  const i = fm.findIndex((l) => /^faq:/.test(l));
  let j = i + 1;
  while (i >= 0 && j < fm.length && !/^\S/.test(fm[j])) j++;
  const faqLines = faq.length
    ? ['faq:', ...faq.flatMap((x) => [`  - q: ${JSON.stringify(x.q)}`, `    a: ${JSON.stringify(x.a)}`])]
    : ['faq: []'];
  if (i >= 0) fm.splice(i, j - i, ...faqLines); else fm.push(...faqLines);
  fs.writeFileSync(f, ['---', ...fm, '---', '', body, ''].join(NL), 'utf8');
  return { history: path.relative(ROOT, path.join(hist, `${stamp}.md`)).replace(/\\/g, '/') };
}

// Production build in the background after a save (debounced; one at a time).
let building = false, again = false, timer = null;
function rebuild() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    if (building) { again = true; return; }
    building = true;
    const log = fs.openSync(path.join(ROOT, 'data', 'rebuild.log'), 'w');
    const p = spawn(process.execPath, [path.join(ROOT, 'node_modules', 'astro', 'bin', 'astro.mjs'), 'build'], { cwd: ROOT, stdio: ['ignore', log, log] });
    p.on('exit', (code) => {
      fs.closeSync(log);
      building = false;
      console.log(`[edit] background build ${code === 0 ? 'done' : `failed (see data/rebuild.log)`}`);
      if (again) { again = false; rebuild(); }
    });
  }, 1500);
}

const send = (res, code, obj) => { res.statusCode = code; res.setHeader('content-type', 'application/json; charset=utf-8'); res.end(JSON.stringify(obj)); };

export default function editPlugin() {
  return {
    name: 'alsuhaiby-edit',
    apply: 'serve', // dev server only
    configureServer(server) {
      server.middlewares.use('/__edit/load', (req, res) => {
        try { send(res, 200, load(new URL(req.url, 'http://x').searchParams.get('slug'))); }
        catch (e) { send(res, 400, { error: e.message }); }
      });
      server.middlewares.use('/__edit/save', (req, res) => {
        if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
        let raw = '';
        req.on('data', (c) => { raw += c; if (raw.length > 2e6) req.destroy(); });
        req.on('end', () => {
          try {
            const r = save(JSON.parse(raw));
            console.log(`[edit] saved ${JSON.parse(raw).slug} (previous version: ${r.history})`);
            rebuild();
            send(res, 200, { ok: true, ...r });
          } catch (e) { send(res, 400, { error: e.message }); }
        });
      });
    },
  };
}
