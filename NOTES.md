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
**NO-WAIT RULE (his rule, 2026-11-10, every long run):** never wait on anything. A video, API call or step that stalls, errors, or asks us to wait more than 30 s is skipped at once and listed under «معلّقة» (id + reason, also kept in the library: fetched.json `deferred`, meta.json `numbersDeferred` / `commentsDeferred`, ledger `failed`); no retries, no back-off. Limits: yt-dlp download and metadata 30 s, R2 upload 30 s, Zernio call 30 s; TikTok rate limits in `night` no longer wait 5–10 min. The end summary shows the «معلّقة» list. Kept as they were by his decision (2026-11-10): our own short pacing between requests (fetch 60 s between TikTok downloads, night 4–8 s, Zernio ≈ 2 s), the machine-health guard's slow/pause, and AI writing calls (work, not waiting).

**DOWNLOAD ONLY — `npm run fetch` (desktop shortcut «تنزيل الصهيبي» → `scripts/fetch.bat`, icon `scripts/fetch.ico`):** yt-dlp → MP4 to R2 → `fetched.json` in the private library. ZERO AI: no Claude, no Gemini, no dedup, no writing (enforced: `ALSUHAIBY_NO_AI=1` makes `chat()` throw). Highest views first; skips videos already on R2 (`data/r2.json`, written after each upload = resume point) or judged "skipped"; a file already on disk is uploaded without touching TikTok. One at a time, 60 s + random 0–10 s between TikTok downloads (20 s until 2026-11-10). A video that fails is set aside on its FIRST failure — `deferred: {kind, reason, at}` in `fetched.json` (kind: login = age-restricted, blocked = TikTok blocks that post, refused = 429/403, error = anything else) — no retry, no back-off, straight to the next video; later runs skip deferred videos until he asks. Only 5 DIFFERENT videos failing in a row (age-restricted not counted) stops the run: clean stop, Arabic message, one ⚠️, and those 5 are un-deferred for a later run. The end summary lists the deferred count by reason and their ids. Lesson (2026-11-10): the 9 Nov "IP block" was ONE post, 7679351937430539540, refusing again and again ("Your IP address is blocked from accessing this post") — not a block on his IP; with it set aside the run downloads normally. Machine guard between videos. `-- --minutes=60` · `-- --limit 10` · `-- --dry-run` · `-- --ids a,b` (only these, even if set aside; success clears it) · `-- --cookies-from-browser=firefox` (his TikTok login, read by yt-dlp at run time only, never stored or printed). Chrome cookies cannot be used: Chrome 127+ (here 156) and Edge lock them with App-Bound Encryption, which yt-dlp cannot read, and getting around it would be bypassing his browser's protection (2026-11-10). Window: after each video «خلص · باقي · بالساعة · المتوقع ينتهي (الكويت)» + title bar; progress `data/run-fetch.json`, log `data/run-fetch.log` (not committed). Pushes every 5 videos and at the end.
**NUMBERS — `npm run numbers` (desktop shortcut «بيانات الصهيبي» → `scripts/numbers.bat`, icon `scripts/numbers.ico`) and COMMENTS — `npm run comments` (shortcut «تعليقات الصهيبي» → `scripts/comments.bat`, icon `scripts/comments.ico`), both in `scripts/meta.js --part=…`:** split 2026-11-10. Both: every library video, highest views first, ZERO AI (`ALSUHAIBY_NO_AI=1`), private library only, resumable, `-- --minutes=N` · `-- --limit 3` · `-- --ids a,b` · `-- --dry-run`, machine guard, live window; a failing video is set aside (`numbersDeferred` / `commentsDeferred`, reason + date), no retry; 5 different in a row = stop (+ ⚠️). NUMBERS: yt-dlp metadata only, no Zernio (~3 s/video, 1 s + 0–2 s apart) → `meta.json[id]` `stats` {views, likes, comments, shares, saves, source 'yt-dlp', capturedAt}, `details` {publishedAt, duration, caption, hashtags}, `numbersAt`; age-restricted videos need a TikTok login and are set aside. COMMENTS (slow background project, only when he starts it, no deadline): Zernio, asked by video id (works for old videos) → `comments/<id>.json` (tiktok / instagram: comments[] {id, text, at, likes, isReply, parentId|replyCount}, accountReplies[] {…, account_reply: true, ai_written: true}; NO commenter names, handles, ids or pictures), `meta.json[id].comments` {capturedAt, tiktok, tiktokExpected, instagram}. Instagram: Zernio lists 862 posts, matched to TikTok videos by caption similarity (character pairs ≥ 0.3) + date (≤ 4 days), one-to-one → 276 (2026-11-10). Zernio's REAL limit for comment reads: 1,800 per hour (429 "Hourly limit of 1800 requests reached for inbox-comments reads"), not the 60/min of its general docs → calls spaced evenly under `zernioCommentsPerHour` (1700) and `zernioPerMinute` (45) in config/site.json (≈ one every 2.1 s), so Zernio never has to tell us to wait; a 429 sends the video to «معلّقة». TikTok's API returns fewer top-level comments than TikTok's own count (replies come back complete): `expectedCount` vs `gotCount` per video; e.g. 965 → 733, 1953 → 315 (first 16 videos: 11,069 of 22,994 = 48%). Progress `data/run-numbers.json` / `data/run-comments.json`, logs `.log` (not committed).
**LINE 1 — prep on his PC:** `npm run night` (the desktop shortcuts «تجهيز الصهيبي» / «— ساعة» were removed 2026-11-08 so writing never starts by accident; `scripts/night.bat` still exists). Close the window any time; it resumes. At the end the window shows an Arabic summary (`scripts/night-summary.js`, from `data/run-night.json`, updated after every video; full log `data/run-night.log`; both not committed). Stops cleanly on Claude's subscription limit, a TikTok block, or 3 failures in a row. `-- --limit 3` · `-- --ids a,b` · `-- --dry-run`.
Time limit: `-- --minutes=60` (or `maxMinutes` in config/site.json; 0 = none, the flag wins). Checked only between videos, so the video in progress is finished and pushed, then the run stops with `stopped: "time"` (not an error, no Telegram) and the summary says so. Second shortcut «تجهيز الصهيبي — ساعة» → `night.bat --minutes=60`, icon `scripts/night-hour.ico` («ص» + orange 60). The main shortcut passes `--minutes=0`, so it stays unlimited even if `maxMinutes` is set. A run can last past the limit by up to one video (~10–25 min).
Per video: yt-dlp → Gemini analysis (cached in the library) → dedup vs live + queued pages (Claude) → merged / skipped / new → Claude writes + strict 2-pass review → MP4 to R2 → `queue/<id>/` → commit + push BOTH repos. Result → data/status.json `lastNight`.

**LINE 2 — publish in the cloud:** `.github/workflows/daily.yml` → `scripts/daily.js`. ~02:07 Kuwait (23:07 UTC) daily; ~05:37 Kuwait missed-run check (catch-up + ⚠️). GitHub can start scheduled jobs late: the first night (cron on the hour) started 3.5 h late, so the times are now off the hour; "Run workflow" button (dry run by default).
New TikTok videos (Zernio, max 5/run) end-to-end with Gemini + Sonnet (~$0.22 each), live same day · then N = publishPerDay pages from the queue · astro build check · push · IndexNow · waits until live. Summary → data/status.json `lastDaily` (no message). Cost guard: the cloud pipeline's OWN spend today (spend.json calls with script `daily`) > $2, or credit < $3 → paid work stops + ⚠️. Manual work and the night run are not counted.
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
- Machine guard (2026-11-08, DECISIONS): `scripts/machine/watcher.py` → `data/machine.json` (level ok / slow / pause / stop + Arabic reasons) · `scripts/lib/machine.js` `machineGate()` between videos in night.js and topics in write.js · window `scripts/machine/meters.pyw` (top-right, drag to move, right-click → سكّر) · desktop widget (2026-11-09): frameless, semi-transparent, no taskbar entry, NOT always-on-top. Desktop-layer pinning (child of Progman/WorkerW) does not work on this PC: Windows 11 build 26300 creates Progman with WS_EX_NOREDIRECTIONBITMAP, so an ordinary (Tk/GDI) window inside it is placed but never painted (tested blank; one test copy also hung). Mode 'follow' instead (auto-chosen; `data/meters-pos.json` → mode): kept under every app window, rises while the desktop is in front (Win+D / desktop clicked), sinks when an app is used; plain drag moves it, position remembered (`data/meters-pos.json`), right-click → «سكّر», or desktop shortcut «إيقاف المراقب» (`meters.pyw --stop` → `data/meters.stop`). Mode 'desktop' code stays for Windows builds that can draw there · desktop shortcut «مراقب الجهاز» (→ `pythonw scripts/machine/meters.pyw`, icon `scripts/machine/meters.ico`; nothing starts with Windows): the window starts its own watcher (`watcher.py --parent <window pid>`), closing it stops that watcher. night/write call `ensureWatcher()` at start and before every gate check: no live watcher → they start one tied to the run (`--parent <node pid>`), which exits with the run; closing the window mid-run → the run starts its own within seconds · tests with fake readings: `python -X utf8 scripts/machine/test_rules.py`, `node scripts/machine/test-gate.js`. Heat signal (no admin, nothing installed): PDH counters `\Processor Information(_Total)\% Processor Performance` (speed vs base clock) and `% Performance Limit`; on mains power, CPU > 50% and speed < 100% or limit < 100 for 2 min → pressure (slow, then pause; never stop). Window row «الحرارة»: طبيعي / حار ويبطّئ نفسه / على البطارية. Full-load test here: speed 152% → ~125% (normal turbo settling), limit stayed 100 → no false alarm; a real overheat was not reproduced. Real degrees stay off: built-in Windows thermal zones on this HP Pavilion Gaming 15-dk0 (i7-9750H) are fixed firmware values (TZ00 27.9 / TZ01 29.9 / TZ02 10.1 °C, unchanged under load); HP firmware WMI `root/HP/InstrumentedBIOS` → `HP_BIOSNumericSensor` exists but needs admin (not tried yet).
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

## Phase 3 acceptance (2026-11-06/07)
1. Dry runs: `npm run night -- --dry-run` ✅ · cloud "Run workflow" dry run ✅ (library checkout, Zernio found 1 new video, queue seen).
2. Night run (real, 5 videos): 1 merged into «سيارتي ترجف وهي واقفة», 3 queued (scores 48–49/60, ~1,070–1,150 words), 1 first skipped then re-checked after the skip rule was loosened (buying advice counts). 0 failures. Claude calls ran on the subscription.
3. Cloud run (real): published 3 pages, astro build check passed, IndexNow 202, all live with their R2 videos:
   - https://alsuhaiby.com/تبي-سيارة-توفر-بنزين-أفضل-سيارات/
   - https://alsuhaiby.com/القير-يتأخر-ويخبط-بالتبديل/
   - https://alsuhaiby.com/علامات-تلف-صينية-القير-العادي/
4. Cost guard tripped as designed: today's spend $8.53 (Phase 1b work earlier the same day) > $2 → the new TikTok video waits for the next run (02:00, new day).

## Publishing rule (2026-11-10, owner)
- Nothing incomplete goes live: a page needs the video file on R2 AND the numbers in the library. Check = scripts/lib/publishable.js, used by publishQueued, queuePage, mergeInto, daily.js and night.js; `npm test` runs its tests.
- Publishable now: 721 of 725. Blocked: only the 4 excluded ids (no file) — 7642038037601324309, 7678048203056401685, 7679351937430539540, 7695835055603748097. 7188529307562609922 got its numbers by hand on 2026-11-10 (likes, saves, shares rounded from TikTok's K display, numbers_rounded: true; comments exact). 7696203758933380372 (removed by TikTok, file + numbers kept) is publishable.

## Security log
- 2026-11-06: the Cloudflare DNS token pasted in chat was rolled. New value in .env verified (DNS read OK); the old value is rejected by Cloudflare ("Invalid API Token").

## Open items
- Real phone speed check on mobile data (Lighthouse already passes).
- UptimeRobot: email alerts only. Telegram alert contact not added (needs a dashboard sign-in; unclear if Telegram is in the free plan's 5 integrations).
- Garage WhatsApp + location: empty in config/site.json (pages show «[يُعبّى يدويًا]»).
- Translations: ready, not generated (`node scripts/write.js --langs ar,en,fr,es,ur` then build-page).
- Archive: 683 videos left (true count from the ledger), handled by `npm run night`. The queue is EMPTY after the test: run `npm run night` or the 02:00 run sends ⚠️ «الطابور فاضي».
- Cloud download of new videos works (7 Nov: video 7705128543423974677 downloaded on GitHub and merged into «سيارتي ترجف وهي واقفة»).
- `review.ar.json` → `factCheck` note: Claude sometimes leaves it empty (the verdicts and notes are there).
