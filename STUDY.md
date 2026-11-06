# Phase 1 — Study notes (2026-11-05)

## Sources found
- Videos: `%USERPROFILE%\Videos\ChatExport_2026-10-30\video_files` — 67 mp4 (221 MB), all < 10 MB (no downscaling needed), 576x1024 mostly.
  - 50 `5889539663_tk*.mp4` = 49 unique TikTok IDs ((25) and (26) are the same video).
  - `tk (50).mp4` is one 18.5 s clip although map.json lists 10 IDs for it → treated as a duplicate of 7371869795513355527.
  - 17 `AQ…`/numeric files are Instagram downloads wrongly mapped to one ID in map.json → ignored for Phase 1.
  - Missing files for two high-view videos: 7214934819308899586 (3.3M), 7275783278387318034 (2.8M).
- Views/dates/captions: `Desktop\KatibSuhaibi\data\outputs\_library.json` (721 videos).
- Existing analyses (transcript + hook + type) for all 48 old videos: `Desktop\KatibSuhaibi\data\files\بيانات-الحساب-والفيديوهات.txt` from line 634 → reused, no re-analysis.
- Fonts/typography: `C:\Reels\engine\review\static\style.css` — Tajawal (body 400/500/700/800), Aref Ruqaa (headings 400/700), heading line-height 1.3, lead 16px/1.7, h1 64→40px mobile, h2 36→28px.

## Tools
node 24.18, npm 11.16, git 2.53, ffmpeg 9.0.1, python 3.14, gh 2.103 (logged in as abu-7sain-ai).

## Embeds (tested 2026-11-05)
- TikTok oEmbed: works, returns `tiktok.com/player/v1/<id>` iframe.
- YouTube oEmbed/iframe: works.
- Instagram oEmbed (graph.facebook.com/instagram_oembed): responds without token (no auth error); real-post test pending — no Instagram URLs known for the old videos.

## Model price (OpenRouter, google/gemini-3.8-flash)
$0.825 / M input, $4.125 / M output (batch variant half price).
