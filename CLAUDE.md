\# WHAT: YouTube Highlight Reel Extension

This is a Chrome Manifest V3 (MV3) extension that extracts "Most Replayed" heatmap data from YouTube videos to create a skippable highlight reel.

\# Tech Stack & Framework

\- Framework: WXT (Web Extension Tools)

\- UI: React 19 + TypeScript

\- Target: Chrome Manifest V3 (MV3)

\# Directory Structure (WXT File-Based Routing)

\- \`entrypoints/popup/\`: Contains the React application for the extension's UI.

\- \`entrypoints/background.ts\`: The event-driven service worker.

\- \`entrypoints/content.ts\`: The content script injected into YouTube pages.

\# HOW: Build & Development Commands

\- Dev Server: \`npm run dev\` (Builds to \`.output/chrome-mv3-dev/\`)

\- Build Production: \`npm run build\`

\- Package: \`npm run zip\`

\# CRITICAL CONSTRAINTS (Always Follow)

1\. \*\*Manifest V3 Service Workers:\*\* Service workers (\`background.ts\`) are ephemeral and terminated by the browser when idle. NEVER use global in-memory variables to store state. Always use \`chrome.storage.local\` or \`chrome.storage.sync\`.

2\. \*\*Message Ports (CRITICAL):\*\* When implementing \`chrome.runtime.onMessage\` listeners in content scripts, you MUST return \`true\` to keep the port open for asynchronous responses. You MUST always call \`sendResponse()\` inside every code path (including error catches) to prevent "message port closed" errors.

3\. \*\*YouTube SPA Navigation:\*\* YouTube is a Single Page Application. Standard \`window.onload\` events will fail when a user clicks a new video. You must use the \`wxt:locationchange\` listener to detect navigation and re-initialize content script logic.

4\. \*\*Defensive DOM Querying:\*\* Not all YouTube videos have a heatmap. You must use strict optional chaining (\`?.\`) when querying \`ytInitialData\` or DOM SVGs. If elements are missing, catch the error gracefully, do not crash, and send a clean error state back to the popup.