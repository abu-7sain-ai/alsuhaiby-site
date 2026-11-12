# DECISIONS (newest first)

## 2026-11-12 — Content audit in the remaining bursts (owner)
1. After the backlog is finished, the remaining bursts audit every live/queued article (highest views first) instead of leaving the weekly quota unused.
2. Three rules, no asking: the video is the reference (contradictions corrected); nothing attributed to him that he never said (removed or reworded as general information); anything not verifiable against the video removed.
3. Length 1150–1400 after the edit by expanding only verified points; never inventing. If that is impossible the accurate shorter article stays (listed «short»).
4. Commit + push after every article; never half-edited.
5. Escalate to the owner only: risk to a reader's safety or to Mohammad's professional reputation — one list, the run never stops for it.

## 2026-11-12 — Bursts follow the real session reset (owner)
1. The old triggers (23:40, 04:40, 09:40, 14:40, 19:40) were deleted, not added to. The task now has exactly three: 11:22 (→12:18), 16:22 (→17:18), 21:00 (→21:58, cut short for the 22:00 weekly reset).
2. Self-correcting: each burst starts one hour before the REAL reset Claude reports (rate_limit_event in a tiny Haiku stream-json call), and stops 2 minutes before it; the armed times are only a fallback.
3. Backlog finished → the whole schedule stops at once (task disabled) with a Telegram. Everything else unchanged: concurrency 6, never-wait, no retries, machine guard, whole-file writes, locks, no publishing, one Telegram per burst end.

## 2026-11-11 — Prep line rules (owner)
1. Queued articles under 1150 words are held (5 taken out of the queue and rewritten). Writer target 1250–1350, up to 2 resizes, reviewer FIX floor 75% in code, one expand pass with fact-check of added sentences only, held if still outside 1150–1400.
2. The 02:07 daily job embeds held duplicates into their live pages while publishing.
3. Commit both repos every video, push the library every video, the site every 10 videos and at the stop. Gemini analysis stays. Restart after a Claude limit is by hand.
4. Concurrency is a setting (3 after the 2026-11-11 test). Shared files have one writer at a time; everything is written whole or not at all; unfinished videos are discarded at each start except the paid analysis.
5. NEVER WAIT, forever: 15-minute cap per video, input/login prompt = skip, no retries, first failure → «معلّقة» (id, step, reason) for handling by hand.

## 2026-11-10 — One project folder
1. Everything lives under Desktop\alsuhaiby: alsuhaiby-site (PUBLIC repo) and alsuhaiby-library (PRIVATE repo) side by side, each with its own .git (never merged, the library never inside the site); media\downloads and media\telegram-export (the videos, were in Videos); archive\ (one-of-a-kind files not in git). KatibSuhaibi stays on the Desktop (separate app).
2. The move is done by the Desktop click-file «نقل المشروع» (scripts/move-project.ps1): refuses while a project process runs; folder moves are single renames; any failure undoes everything; shortcuts (target, working folder, icon) and Claude Code memory updated; verified before anything is removed; removals go to the Recycle Bin only (duplicates re-checked byte for byte).

## 2026-11-10 — Garage contact details filled
1. WhatsApp 99168778 (click-to-chat https://wa.me/96599168778). Address shown line by line exactly as the owner wrote it (الشويخ الصناعية 2 / قطعة 1 / شارع 24 / قسيمة 27و / الرقم الآلي للعنوان: 90129093), with the button «اضغط للموقع على قوقل ماب» (Google Maps, new tab).
2. One garage entity in JSON-LD (AutoRepair, @id alsuhaiby.com/#garage): streetAddress, addressLocality, addressCountry KW, telephone +96599168778, hasMap, PACI number. Same object on the about, contact and every video page (Person.worksFor).
3. Shown on the contact and about pages (components/GarageContact.astro); data in config/site.json → garage. No placeholder text is left in the repo.

## 2026-11-10 — Incomplete data is never published (owner's standing rule)
1. A video is published only when it has BOTH its video file on R2 and its interaction numbers (likes, comments and saves; shares and views may be null). Missing either = no page, no embed, no queue slot.
2. Enforced in code (scripts/lib/publishable.js): publishQueued refuses an incomplete video even if it is already in the queue; queuePage / mergeInto refuse it; daily.js picks only complete videos for its slots and checks a new video's numbers before any paid step; night.js does not spend writing on one. If the private library cannot be read, nothing is published. Test: `npm test` (fakes only).
3. Excluded permanently (numbers but no file; excludeFromPublishing in meta.json, ledger status "excluded"): 7642038037601324309, 7678048203056401685, 7679351937430539540, 7695835055603748097.
4. Removal by TikTok is NOT by itself a reason to exclude: 7696203758933380372 was removed but has its file and numbers, so it stays publishable. Missing data is the reason.

## 2026-11-10 — Numbers + comments pass
1. `npm run meta` / shortcut «بيانات الصهيبي»: for every video, numbers, details, platform links and the COMMENTS go into the private library (meta.json, comments/<id>.json). No Claude, no Gemini.
2. Comments are stored WITHOUT names or handles (the questions people ask, not who asked). Other people's replies are kept, marked as replies.
3. His account's replies are kept apart as account_reply, ai_written: true (an employee wrote them with an AI): never a source of his own words, only a record of which questions were answered.
4. Comments come from Zernio (it answers by video id even for old videos); numbers from Zernio where it tracks the post, yt-dlp metadata otherwise; every number records its source and capture date. yt-dlp cannot fetch TikTok comments (no code for it in 2026.10.26).
5. Instagram posts are matched to TikTok videos by caption + date; matched ones get their link, numbers and comments.
6. Order: highest views first, so an early stop still has the biggest videos. Zernio pace is a setting (zernioPerMinute, 45).
7. Split (his decision, 2026-11-10): NUMBERS now (yt-dlp only, no Zernio, under an hour, «بيانات الصهيبي») and COMMENTS later as a slow background project that runs only when he starts it («تعليقات الصهيبي»), no deadline. The combined run was stopped with 16 videos of comments kept.
8. Zernio's real limit for comment reads is 1,800 per hour; the comments pass is paced under it (zernioCommentsPerHour 1700).
9. TikTok's API (through Zernio) returns fewer top-level comments than TikTok's own count; replies come back complete. We store what it returns and record the expected count beside it.
10. NO-WAIT RULE for every long run (his rule): nothing waits more than 30 s — a stalled step, an error or a "wait" answer skips the item into «معلّقة» (id + reason, shown at the end for him to handle by hand); no retries, no back-off. Applied to fetch, numbers, comments and night's TikTok rate limit. His answers (2026-11-10): the machine-health guard keeps pausing as it is; the 60 s gap between TikTok downloads and the AI writing calls in night stay (they are not covered by the rule).

## 2026-11-09 — Meters window as a desktop widget
1. Asked: pin it into the desktop layer (on the wallpaper, behind all windows, seen with Win+D). Tried and tested: on this PC (Windows 11 build 26300) the desktop window Progman has WS_EX_NOREDIRECTIONBITMAP, so an ordinary window parented there (between icons and wallpaper, above the icons, or inside the wallpaper WorkerW) is placed but never drawn. Not forced (his rule: offer the nearest alternative).
2. Nearest alternative, now the default here (chosen automatically): frameless, semi-transparent, no taskbar entry; under every app window; rises only while the desktop is in front (Win+D or a click on the desktop) and sinks as soon as an app is used. Drag to move, position remembered; close with right-click «سكّر» or the desktop shortcut «إيقاف المراقب». He approved it (2026-11-09: «Keep it»).

## 2026-11-08 — Download-only line
1. `npm run fetch` / desktop shortcut «تنزيل الصهيبي»: download → R2 → library record only. No Claude subscription, no Gemini, no dedup, no writing.
2. The two «تجهيز الصهيبي» shortcuts (download + write together) moved to the Recycle Bin so writing never starts by accident; their scripts stay. Writing runs only by command (`npm run night`) for now.
3. TikTok: one at a time, 60 s + 0–10 s jitter (20 s until 2026-11-10).
4. Failures (his rule, 2026-11-10): a failing video is set aside ("deferred", reason + date) on its first failure, never retried and never retried by later runs unless he asks; no back-off wait. The run stops only when 5 DIFFERENT videos fail in a row (the real sign of an IP block or a network problem; Arabic message + one ⚠️). The end summary lists how many were deferred and why. Replaces the back-off-and-retry rule.
5. Learned 2026-11-10: the 9 Nov "IP block" was one single post (7679351937430539540) refusing again and again, not a block on his IP. With it set aside, downloads run normally.

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
4. Newspaper name: «سراة نيوز». Garage location / WhatsApp: a visible placeholder until filled (filled 2026-11-10).
5. Archive size: 721 videos (not 615). Always «كراج», never «ورشة».

## 2026-11-05 — Phase 1
1. GitHub public repo abu-7sain-ai/alsuhaiby-site. 2. One page per topic; strongest video is the main one, others embedded.
3. Six-dimension quality scale. 4. Instagram files left out. 5. Reports in English with a Kuwait-time ETA and one status line.
