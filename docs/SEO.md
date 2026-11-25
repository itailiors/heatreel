# SEO: HeatReel

Maintained by the shared SEO expert (`claude-projects/SEO`, run `/seo-audit HeatReel` there).

- **Channel(s):** Chrome Web Store, GitHub repo, portfolio-hub card
- **Live URL:** https://chromewebstore.google.com/detail/pljkjcipfkonmhnhfkfjbhjjkbhpfihf
- **Audience:** people who watch long YouTube videos (podcasts, streams, lectures, matches) and want the best parts
- **Competitors (3):** not researched yet (to do)
- **Primary keyword:** YouTube most replayed (to confirm)  **Secondary:** YouTube highlights, skip to best part of video
- **Last audit:** 2026-11-25  **Next optimize:** 2027-02-03

## Current listing (quoted 2026-11-25)
- Title: HeatReel
- Short summary: Play the "Most Replayed" moments of a YouTube video as a highlight reel.
- Description: "HeatReel automatically finds and plays the most replayed moments of any YouTube video using intelligent heatmap analysis." plus a line on keyboard shortcuts and a native mini-player.
- Category: Tools. 1 rating (5.0), 6 users, v1.0.0, updated 2026-11-17.
- GitHub repo: no description, no topics, no homepage.

## Done (2026-11-25)
- GitHub repo description, homepage (store link) and topics set. README now links to the Chrome Web Store and the hub product page.
- Still open: store-dashboard items 1, 2, 3, 5, 6 below (title, description, privacy link, screenshots, review prompt). Needs the Chrome Web Store dashboard.

## Open fixes (ranked, original audit)
1. Title is the bare brand. Use "HeatReel: YouTube Most Replayed Highlights" style (keep under the store's limit; confirm in CWS docs). Field: wxt.config.ts `name` + store listing.
2. Full description is two sentences. Write a real one: pitch, bullet features (Smart Auto Reel, mini-player, shortcuts, timestamp comments), "no account, no server". Source: README + ecosystem.json features. Store dashboard.
3. No privacy policy URL or support site on the listing. Add a privacy page (README Privacy section on GitHub works) and a support link. Store dashboard.
4. GitHub repo has no description or topics. Add description + topics (chrome-extension, youtube, highlights). `gh repo edit`.
5. Screenshots: 7 entries, some duplicates. Dedupe, make the first 2-3 show the benefit with captions.
6. Only 1 rating. Add an in-product review prompt at a good moment (after a reel finishes). Never incentivise.
7. Product hub card: media is a placeholder. Add a real screenshot/GIF, and the card's CTA already carries `utmTag`.
8. Competitor and keyword research not done yet (needs Search Console / CWS dashboard terms).

## Could not check
- Store page meta tags (JS-rendered, not readable), Chrome Web Store dashboard search terms and traffic sources, any Search Console data, rankings for the target keywords.

## Metrics (monthly)
| Month | Impressions | Clicks | Installs | Rating |
|---|---|---|---|---|
| 2026-11 | n/a | n/a | 6 users | 5.0 (1) |
