# NOTES — alsuhaiby.com (read this first)

Personal SEO site of محمد الصهيبي (Kuwaiti car mechanic, «كراج الصهيبي»). One page per video topic, Arabic first, four more languages ready.
Rules: CONSTITUTION.md · decisions: DECISIONS.md · Arabic how-to: README.md · original study: STUDY.md.

## Where things are
| What | Where |
|---|---|
| Live site | https://alsuhaiby.com (Cloudflare Workers static assets, worker `alsuhaiby-site`) |
| Videos (MP4) | Cloudflare R2 bucket `alsuhaiby-media` → https://media.alsuhaiby.com/<tiktokId>.mp4 |
| Deploy | Every push to `main` → Cloudflare Workers Builds runs `npm run build` + `npx wrangler deploy` |
| Manual deploy | `npm run deploy` (build + wrangler deploy; needs `wrangler login`) |
| Source videos | `~/Videos/ChatExport_2026-10-30/video_files` (69 old files) + `~/Videos/alsuhaiby-downloads/<id>.mp4` (yt-dlp, night run). Never committed |
| Private library | `~/Desktop/alsuhaiby-library` = PRIVATE repo abu-7sain-ai/alsuhaiby-library: library.json (all videos), ledger.json (dedup), videos/<id>/{analysis,dedup,write.ar,review.ar,final.ar}.json |
| Queue | `queue/<id>/` (page.md + cover/thumb/og + meta.json) — written by the night run, published by the cloud |
| Published log | `data/published.json` (id → slug, date; never republished) |
| Pages | `content/videos/<lang>/<slug>.md` (archived pages: `content/_archive/`, hand-edit history: `content/_history/`) |
| User settings | `config/site.json` — garage WhatsApp, garage location, enabled languages, media host, `publishPerDay` (default 7) |
| Status ("dashboard") | `data/status.json` — refresh with `npm run status` |
| Spend log | `data/spend.json` · R2 upload log: `data/r2.json` · IndexNow key: `data/indexnow-key.txt` |
| DNS | `node scripts/lib/dns.js list|add-txt` (CLOUDFLARE_API_TOKEN in .env, Zone:DNS:Edit for alsuhaiby.com) |
| Secrets | `.env` on his PC (OPENROUTER_API_KEY, CLOUDFLARE_API_TOKEN = DNS + R2 edit, ZERNIO_API_KEY; git-ignored). On his PC Telegram goes through the Reels app (`C:/Reels/engine`). GitHub Actions secrets: OPENROUTER_API_KEY, CLOUDFLARE_API_TOKEN, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, ZERNIO_API_KEY, LIBRARY_DEPLOY_KEY |

## Daily pipeline (Phase 3, two lines)
**LINE 1 — prep on his PC:** `npm run night` (Ctrl+C any time; it resumes). `-- --limit 3` · `-- --ids a,b` · `-- --dry-run`.
Per video: yt-dlp → Gemini analysis (cached in the library) → dedup vs live + queued pages (Claude) → merged / skipped / new → Claude writes + strict 2-pass review → MP4 to R2 → `queue/<id>/` → commit + push BOTH repos. Result → data/status.json `lastNight`.

**LINE 2 — publish in the cloud:** `.github/workflows/daily.yml` → `scripts/daily.js`. 02:00 Kuwait (23:00 UTC) daily; 05:00 Kuwait missed-run check (catch-up + ⚠️); "Run workflow" button (dry run by default).
New TikTok videos (Zernio, max 5/run) end-to-end with Gemini + Sonnet (~$0.22 each), live same day · then N = publishPerDay pages from the queue · astro build check · push · IndexNow · waits until live. Summary → data/status.json `lastDaily` (no message). Cost guard: today's spend > $2 or credit < $3 → paid work stops + ⚠️.
Local check: `node scripts/daily.js --dry-run`.

## Phase 1b tools (the first 20 pages, data/topics.json)
1. `node scripts/analyze.js --topics` — Gemini watches each video once (cached).
2. `node scripts/write.js` — one video → one long Arabic article (draft 1150–1400 words). `--langs ar,en,fr,es,ur` for translations.
3. `node scripts/review.js` — Sonnet error review (fix/cut only what is wrong, contradicts the video, filler, not Kuwaiti). Logged on /review/.
4. `node scripts/build-page.js` — Markdown pages + covers + uploads new MP4s to R2. Never overwrites a page edited by hand (`manualEdit`).
5. Commit + push → live in ~1–2 min.
Every step: `guard()` records the run in data/status.json and sends ⚠️ to Telegram on failure. Credit < $3 → ⚠️ (once a day).

## Local review / editing
`npm run dev` → http://localhost:4321/review/ (or the Network URL on the phone). «تعديل» edits title, summary, body, FAQ; old version kept in content/_history/. /review/ does not exist on the live site.

## Alerts and monitoring
- Telegram (rule 2026-11-07): ONLY ⚠️ (failed run, cost guard, credit < $3, missed run, site down, empty queue) and ❓ (a question waiting). Nothing on success. `scripts/lib/telegram.py` → the Reels app's «مجموعة التنبيهات» group (on the PC) or TELEGRAM_BOT_TOKEN/CHAT_ID (cloud). The user-level Stop hook is silent on ✅/⏳ for this project (SILENT_ON_SUCCESS in C:/Reels/engine/tools/notify_telegram.py).
- UptimeRobot: monitor on https://alsuhaiby.com every 5 minutes, email alerts (account Abu.7sain.ai@gmail.com).

## Phase 2 acceptance (2026-11-06) — COMPLETE
1. Speed (Lighthouse mobile, simulated slow 4G, live domain): home 99 · LCP 2.0 s; video page 99 · LCP 1.9 s; topics 99 · LCP 1.9 s. Real phone check on mobile data: pending (Mohammad).
2. Video page plays from R2 in the clean player (no iframe; range requests 206). ✅
3. Search Console: Domain property alsuhaiby.com VERIFIED (DNS TXT added with scripts/lib/dns.js) and sitemap https://alsuhaiby.com/sitemap-index.xml ACCEPTED. ✅
4. Telegram test ✅ sent to «مجموعة التنبيهات» (scripts/lib/status.js --test-alert).
5. Push to main → Cloudflare deployed by itself 24 s later. ✅
Bing: DONE via IndexNow — all 25 URLs submitted (HTTP 202); key file at /<key>.txt (data/indexnow-key.txt). No Bing Webmaster account needed.
UptimeRobot: monitor on https://alsuhaiby.com every 5 min with EMAIL alerts.

## Security log
- 2026-11-06: the Cloudflare DNS token pasted in chat was rolled. New value in .env verified (DNS read OK); the old value is rejected by Cloudflare ("Invalid API Token").

## Open items
- Real phone speed check on mobile data (Lighthouse already passes).
- UptimeRobot: email alerts only. Telegram alert contact not added (needs a dashboard sign-in; unclear if Telegram is in the free plan's 5 integrations).
- Garage WhatsApp + location: empty in config/site.json (pages show «[يُعبّى يدويًا]»).
- Translations: ready, not generated (`node scripts/write.js --langs ar,en,fr,es,ur` then build-page).
- Archive: 687 videos left at the start of Phase 3 (true count from the ledger), handled by `npm run night`.
