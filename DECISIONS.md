# DECISIONS (newest first)

## 2026-11-09 — Meters window as a desktop widget
1. Asked: pin it into the desktop layer (on the wallpaper, behind all windows, seen with Win+D). Tried and tested: on this PC (Windows 11 build 26300) the desktop window Progman has WS_EX_NOREDIRECTIONBITMAP, so an ordinary window parented there (between icons and wallpaper, above the icons, or inside the wallpaper WorkerW) is placed but never drawn. Not forced (his rule: offer the nearest alternative).
2. Nearest alternative, now the default here (chosen automatically): frameless, semi-transparent, no taskbar entry; under every app window; rises only while the desktop is in front (Win+D or a click on the desktop) and sinks as soon as an app is used. Drag to move, position remembered; close with right-click «سكّر» or the desktop shortcut «إيقاف المراقب». He approved it (2026-11-09: «Keep it»).

## 2026-11-08 — Download-only line
1. `npm run fetch` / desktop shortcut «تنزيل الصهيبي»: download → R2 → library record only. No Claude subscription, no Gemini, no dedup, no writing.
2. The two «تجهيز الصهيبي» shortcuts (download + write together) moved to the Recycle Bin so writing never starts by accident; their scripts stay. Writing runs only by command (`npm run night`) for now.
3. TikTok: one at a time, 20 s + 0–10 s jitter, exponential back-off on refusals, stop after 5 failures in a row (Arabic message + one ⚠️).

## 2026-11-08 — Machine-health guard + desktop meters
1. An always-on watcher (`scripts/machine/watcher.py`, hidden) samples CPU, free RAM and free disk (C:) every 30 s into `data/machine.json` (not committed).
2. Long commands (`night`, `write`; the download step is inside `night`) check it between videos / topics. There is no parallel work to halve, so: CPU > 85% for 3 min or free RAM < 1.5 GB → "slow" = wait 2 min before the next one; the same pressure 3 min later → "pause" = wait until it clears, then carry on by itself; free disk < 5 GB → "stop" = finish the current video, stop cleanly with an Arabic message.
3. Telegram ONLY on a full stop, never on slow / pause. The machine is never shut down or restarted by this.
4. Temperature is OFF: Windows gives no real CPU temperature without a sensor tool (the ACPI zones read ~28–30°C, not the CPU). He chose not to install anything for now; LibreHardwareMonitor (free, MPL-2.0, v0.9.6, needs admin + its PawnIO driver) is the option if he wants the "> 90°C for 2 min → stop" rule later.
5. Desktop meters: our own small always-on-top window (`scripts/machine/meters.pyw`, Arabic labels, every 2 s) instead of HWiNFO / Rainmeter (HWiNFO free cuts sensor sharing after 12 h; Rainmeter needs HWiNFO for temperature). It also shows what the pipeline is doing and how many are left (`data/run-stage.json`).
6. A missing or stale watcher never blocks work (one Arabic warning).
7. NO auto-start with Windows (his decision). Desktop shortcut «مراقب الجهاز» opens the window, which starts its own watcher; closing the window stops it. The guard does not depend on the window: night/write start their own watcher when none is alive and it ends with the run.
8. Temperature check (2026-11-08): no real CPU temperature through built-in Windows means without admin. The ACPI thermal zones are fixed values (did not move under a CPU load test). HP's firmware sensor class (`HP_BIOSNumericSensor`) needs admin; not tried. Nothing installed.
9. His choice: the overheating SIGNAL, not degrees (no admin, nothing installed). Busy CPU (> 50%) on mains power running below its base clock, or firmware-limited, for 2 min = "hot" → same as other pressure: slow, then pause; never a stop, no Telegram. Ignored on battery. Window row «الحرارة» shows Arabic words only (numbers on the same line scramble the right-to-left order).

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
18. Night run time limit: `maxMinutes` (config/site.json, default 0 = none) or `--minutes=N`. On the limit, the current video is finished and pushed, then a clean stop (not an error). Second desktop shortcut «تجهيز الصهيبي — ساعة» = 60 minutes; the original shortcut stays unlimited.
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
