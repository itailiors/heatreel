# HeatReel: YouTube Highlight Reel Extension

A Chrome Manifest V3 (MV3) extension that extracts "Most Replayed" heatmap data from YouTube videos to create a skippable highlight reel.

## Tech stack

- Framework: WXT (Web Extension Tools)
- UI: React 19 + TypeScript
- Target: Chrome Manifest V3 (MV3)

## Directory structure (WXT file-based routing)

- `entrypoints/popup/`: the React app for the extension's UI.
- `entrypoints/background.ts`: the event-driven service worker.
- `entrypoints/content.ts`: the content script injected into YouTube pages.

## Commands

- Dev server: `npm run dev` (builds to `.output/chrome-mv3-dev/`)
- Build production: `npm run build`
- Package: `npm run zip`
- Type check: `npm run compile`

## Definition of done

- `npm run compile && npm run build` both pass. Report the result; never say "done" without it.
- There are no automated tests, so for behaviour changes also say what you could not verify in a real Chrome (load `.output/chrome-mv3-dev/` as an unpacked extension).

## Critical constraints (always follow)

1. **Manifest V3 service workers:** `background.ts` is ephemeral and terminated by the browser when idle. NEVER use global in-memory variables to store state. Always use `chrome.storage.local` or `chrome.storage.sync`.
2. **Message ports:** in `chrome.runtime.onMessage` listeners you MUST return `true` to keep the port open for asynchronous responses. You MUST always call `sendResponse()` in every code path (including error catches) to prevent "message port closed" errors.
3. **YouTube SPA navigation:** YouTube is a single-page app, so `window.onload` fails when a user clicks a new video. Use the `wxt:locationchange` listener to detect navigation and re-initialize content script logic.
4. **Defensive DOM querying:** not all YouTube videos have a heatmap. Use strict optional chaining (`?.`) when querying `ytInitialData` or DOM SVGs. If elements are missing, catch the error gracefully, do not crash, and send a clean error state back to the popup.
