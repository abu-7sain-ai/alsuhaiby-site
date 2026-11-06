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
| Source videos | `~/Videos/ChatExport_2026-10-30/video_files` (never committed; cache JSONs sit next to each video) |
| Pages | `content/videos/<lang>/<slug>.md` (archived pages: `content/_archive/`, hand-edit history: `content/_history/`) |
| User settings | `config/site.json` — garage WhatsApp, garage location, enabled languages, media host |
| Status ("dashboard") | `data/status.json` — refresh with `npm run status` |
| Spend log | `data/spend.json` · R2 upload log: `data/r2.json` · IndexNow key: `data/indexnow-key.txt` |
| Secrets | `.env` (OPENROUTER_API_KEY, git-ignored). Telegram token: read at run time by the Reels app (`C:/Reels/engine`), never copied |

## Pipeline
1. `node scripts/analyze.js --topics` — Gemini watches each video once (cached).
2. `node scripts/write.js` — one video → one long Arabic article (draft 1150–1400 words). `--langs ar,en,fr,es,ur` for translations.
3. `node scripts/review.js` — Sonnet error review (fix/cut only what is wrong, contradicts the video, filler, not Kuwaiti). Logged on /review/.
4. `node scripts/build-page.js` — Markdown pages + covers + uploads new MP4s to R2. Never overwrites a page edited by hand (`manualEdit`).
5. Commit + push → live in ~1–2 min.
Every step: `guard()` records the run in data/status.json and sends ⚠️ to Telegram on failure. Credit < $3 → ⚠️ (once a day).

## Local review / editing
`npm run dev` → http://localhost:4321/review/ (or the Network URL on the phone). «تعديل» edits title, summary, body, FAQ; old version kept in content/_history/. /review/ does not exist on the live site.

## Alerts and monitoring
- Telegram: `scripts/lib/telegram.py` → the Reels app's «مجموعة التنبيهات» group (✅ published, ⚠️ failure / low credit / catch-up run).
- UptimeRobot: monitor on https://alsuhaiby.com every 5 minutes (account Abu.7sain.ai@gmail.com).

## Phase 2 acceptance (2026-11-06)
1. Speed (Lighthouse mobile, simulated slow 4G, live domain): home 99 · LCP 2.0 s; video page 99 · LCP 1.9 s; topics 99 · LCP 1.9 s. Real phone check on mobile data: pending (Mohammad).
2. Video page plays from R2 in the clean player (no iframe; range requests 206). ✅
3. Search Console verified + sitemap: PENDING — needs a Google sign-in inside Claude's built-in browser (Chrome's own profile cannot be automated).
4. Telegram test ✅ sent to «مجموعة التنبيهات» (scripts/lib/status.js --test-alert).
5. Push to main → Cloudflare deployed by itself 24 s later. ✅
Bing: all 25 URLs submitted via IndexNow (202). Bing Webmaster import from Google: pending with item 3.
UptimeRobot: monitor exists (email alerts); Telegram contact pending the same sign-in.

## Open items
- Scheduler (automatic pull of new videos) = Phase 3; status shows "not set (Phase 3)".
- Garage WhatsApp + location: empty in config/site.json (pages show «[يُعبّى يدويًا]»).
- Translations: ready, not generated (`node scripts/write.js --langs ar,en,fr,es,ur` then build-page).
- Archive (721 videos) = Phase 4, batch pricing.
