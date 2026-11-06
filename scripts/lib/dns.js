// dns.js — DNS records for alsuhaiby.com through the Cloudflare API, with CLOUDFLARE_API_TOKEN from .env (Zone:DNS:Edit).
// The token is read at run time and never printed.
//   node scripts/lib/dns.js check                    token valid? (prints status only)
//   node scripts/lib/dns.js list [TYPE]              list records (type, name, content)
//   node scripts/lib/dns.js add-txt "<value>" [name]  add a TXT record (default name: alsuhaiby.com); skipped if it already exists
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './common.js';

const ZONE = '6e98bcf10574511e3384d47d890e55b9'; // alsuhaiby.com
const DOMAIN = 'alsuhaiby.com';

function token() {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;
  const f = path.join(ROOT, '.env');
  for (const line of fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split(/\r?\n/) : []) {
    const m = line.match(/^\s*CLOUDFLARE_API_TOKEN\s*=\s*(.+?)\s*$/);
    if (m && m[1]) return m[1].replace(/^['"]|['"]$/g, '');
  }
  throw new Error('CLOUDFLARE_API_TOKEN is missing in .env');
}

async function cf(method, url, body) {
  const tok = token();
  const r = await fetch(`https://api.cloudflare.com/client/v4${url}`, {
    method, headers: { Authorization: `Bearer ${tok}`, 'content-type': 'application/json' }, body: body && JSON.stringify(body),
  });
  const j = await r.json();
  if (!j.success) throw new Error(`Cloudflare ${r.status}: ${JSON.stringify(j.errors).replaceAll(tok, '[secret]')}`);
  return j.result;
}

const [cmd, a, b] = process.argv.slice(2);
if (cmd === 'check') {
  const r = await cf('GET', '/user/tokens/verify').catch(() => cf('GET', `/zones/${ZONE}/dns_records?per_page=1`).then(() => ({ status: 'active (zone access ok)' })));
  console.log('token:', r.status);
} else if (cmd === 'list') {
  for (const x of await cf('GET', `/zones/${ZONE}/dns_records?per_page=100${a ? `&type=${a}` : ''}`)) console.log(x.type, x.name, x.content.slice(0, 90));
} else if (cmd === 'add-txt') {
  const name = b || DOMAIN;
  const content = `"${String(a).replace(/^"|"$/g, '')}"`;
  const have = await cf('GET', `/zones/${ZONE}/dns_records?type=TXT&name=${encodeURIComponent(name)}`);
  if (have.some((x) => x.content.replace(/"/g, '') === content.replace(/"/g, ''))) console.log('TXT already present');
  else {
    await cf('POST', `/zones/${ZONE}/dns_records`, { type: 'TXT', name, content, ttl: 1, comment: 'added by scripts/lib/dns.js' });
    console.log('TXT added on', name);
  }
} else {
  console.log('usage: node scripts/lib/dns.js check | list [TYPE] | add-txt "<value>" [name]');
}
