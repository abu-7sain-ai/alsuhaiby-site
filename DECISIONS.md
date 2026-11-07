# DECISIONS (newest first)

## 2026-11-07 — Phase 3 (two lines)
1. Two independent lines. LINE 1 (prep) = `npm run night` on his PC: yt-dlp download → Gemini analysis (~$0.01, the only paid call) → dedup → Claude Code (his subscription) writes + reviews twice → MP4 on R2 → page into `queue/`. LINE 2 (publish) = GitHub Actions daily at 02:00 Kuwait + manual button.
2. The earlier "everything in the cloud with Sonnet, 6 pages/day, ~$90–150 archive" plan is dropped.
3. Queue: `queue/<id>/` in the public site repo (page.md + images + meta.json). The cloud publishes N per day (`publishPerDay` in config/site.json, default 7 → 1 when the backlog is gone), highest views first, and never republishes (`data/published.json`).
4. New videos from his TikTok (via Zernio) are handled end-to-end in the cloud (Gemini writes, Sonnet reviews, ~$0.22 each), go live the same day and do not take a queue slot. At most 5 per run. If the cloud cannot download one, the night run takes it.
5. Dedup: every video is compared with the live AND queued pages before writing. Same symptom = embedded on that page ("merged"), not a new page; not an article = "skipped". The ledger (private library) records every decision with its reason; the true remaining count is computed (687 at the start, not 721).
6. Embedding a merged video on a hand-edited page (`manualEdit`) changes only the frontmatter `otherVideos` list; the text he edited stays byte for byte.
7. Review is strict: every factual claim is checked; a claim that cannot be confirmed (DOUBT) is removed and logged with its reason, like FIX and CUT; pass 2 re-checks and scores /60.
8. Private library `abu-7sain-ai/alsuhaiby-library` holds library.json (all videos), ledger.json, and per video analysis / dedup / draft / review / final. The public repo holds no transcripts or drafts. «كاتب الصهيبي» reads from it and is not touched by this project.
9. Cost guard (cloud): paid work stops if today's spend (Kuwait day) > $2 or the key credit < $3, with a ⚠️.
10. Telegram (his rule, replaces the daily summary): a message ONLY when something needs him or broke — ⚠️ failed run, cost guard, credit < $3, missed scheduled run (05:00 check runs a catch-up), site down, queue empty with nothing published; ❓ a question waiting on him. NOTHING on success (no published ping, no daily summary, no progress, no completion). The day's summary is in data/status.json → lastDaily; the night run's in → lastNight.
15. Cost guard counts only the cloud pipeline's own spend for the day (script `daily`), not manual work or the night run (7 Nov: a new video was wrongly blocked by $8.53 of Phase 1b work).
16. Schedule moved off the hour (23:07 and 02:37 UTC) because GitHub delays on-the-hour jobs (first run: 3.5 h late).
17. Night run starts from a desktop shortcut «تجهيز الصهيبي» (no terminal); its window ends with a short Arabic summary and explains a Claude-limit stop in plain Arabic. 3 failures in a row stop the run.
14. The user-level Claude Code Stop hook (C:/Reels/engine/tools/notify_telegram.py) is silent on ✅ done / ⏳ still running for the alsuhaiby-site and alsuhaiby-library folders (SILENT_ON_SUCCESS); ❓ questions, ⚠️ errors and permission prompts still ping. Other projects unchanged.
11. Secrets in GitHub Actions: OPENROUTER_API_KEY, CLOUDFLARE_API_TOKEN (DNS + R2 edit), TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, ZERNIO_API_KEY, LIBRARY_DEPLOY_KEY. Set from where they already live, never printed.
12. Headless Claude calls use their own system prompt, no tools, no MCP and no user settings, so his Telegram Stop hook does not fire per call and each call stays small.
13. TikTok rate limit on his PC: 4–8 s between downloads; on a rate-limit reply wait 5, then 10 minutes; after 3 in a row the night run stops and says so.

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
