// Build stamp: which commit the live site was built from. scripts/deploy-check.js compares it with main's HEAD
// (a Cloudflare build that fails leaves the old site live with no other sign). Served at /build.json.
import { execSync } from 'node:child_process';

// Cloudflare Workers Builds sets WORKERS_CI_COMMIT_SHA; a local build falls back to git.
const sha = process.env.WORKERS_CI_COMMIT_SHA || (() => {
  try { return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim(); } catch { return 'unknown'; }
})();
const builtAt = new Date().toISOString();

export function GET() {
  return new Response(JSON.stringify({ sha, builtAt, ci: process.env.WORKERS_CI === '1' }), { headers: { 'Content-Type': 'application/json' } });
}
