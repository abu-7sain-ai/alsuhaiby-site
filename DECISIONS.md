# DECISIONS (newest first)

## 2026-11-06 — Phase 2 (publish)
1. Video player = his own MP4s on Cloudflare R2 (media.alsuhaiby.com) in a plain HTML5 `<video>`: cover as poster, controls only, no autoplay, `preload="none"`. No TikTok embed. Links to TikTok/Instagram/YouTube stay under the player.
2. Other videos on a page show a lazy cover + play button and become the same `<video>` on tap (keeps the page under 2 s).
3. Hosting = Cloudflare Workers (static assets), not Pages. Auto-deploy from GitHub `main` via Workers Builds. http and www → https://alsuhaiby.com (301, in worker/index.js).
4. /review/ exists only in `npm run dev`; removed from every production build.
5. `config/site.json` holds user-editable settings; the advisor edits it on GitHub.
6. Status lives in `data/status.json` (read in Claude chat), not on a page. "next scheduled run: not set (Phase 3)".
7. Alerts go one-way to the Reels app's «مجموعة التنبيهات» Telegram group (same bot).
8. Uptime: UptimeRobot free, every 5 minutes, email alerts (Telegram not added).
9. Bing gets URLs through IndexNow (no login); no Bing Webmaster account.
10. Google Search Console: Domain property, verified by DNS TXT; sitemap-index.xml accepted.
11. DNS changes go through the Cloudflare API with a Zone:DNS:Edit token for alsuhaiby.com only (CLOUDFLARE_API_TOKEN in .env, scripts/lib/dns.js). Tokens are never pasted in chat.
12. Phase 2 closed 2026-11-06.

## 2026-11-06 — writing (Phase 1b)
1. One video → one long article (800–1500 words): the transcript is the starting point, expanded with correct general knowledge.
2. Sonnet review only fixes/cuts errors, contradictions with the video, filler and non-Kuwaiti wording. A fix may not shrink a sentence by 40%+ (rejected and logged).
3. «تعديل» editor on /review/ (dev only); hand-edited pages are never overwritten; history in content/_history/.
4. Newspaper name: «سراة نيوز». Garage location / WhatsApp: «[يُعبّى يدويًا]» until filled.
5. Archive size: 721 videos (not 615). Always «كراج», never «ورشة».

## 2026-11-05 — Phase 1
1. GitHub public repo abu-7sain-ai/alsuhaiby-site. 2. One page per topic; strongest video is the main one, others embedded.
3. Six-dimension quality scale. 4. Instagram files left out. 5. Reports in English with a Kuwait-time ETA and one status line.
