<p align="center">
  <img src="public/icon.svg" width="96" alt="HeatReel logo">
</p>

<h1 align="center">HeatReel</h1>

<p align="center">
  Turn any YouTube video into a highlight reel of its <b>Most Replayed</b> moments.
</p>

---

HeatReel is a Chrome extension that reads YouTube's "Most Replayed" heatmap and plays just the
best parts of a video, back to back. One click, no setup.

## Features

- **Smart Auto Reel**: analyses the whole heatmap statistically (mean + standard deviation) to find
  the moments that stand out *for this specific video*, groups neighbouring peaks into clips and
  plays them in order. Flat heatmaps fall back to the top 15% of moments.
- **Mini player overlay**: a small pill inside the player (works in full screen) with
  ⏮️ / ⏭️ controls, "Highlight X of Y" and a live clip timer.
- **Start button in the YouTube player**: a flame button next to YouTube's own controls.
- **Manual controls**: pick the number of highlights and seconds per clip, or set a minimum heat
  threshold to play every moment above it.
- **Share**: copy the timestamps (optionally with `youtu.be` links), or post them as a comment,
  with 🔥 / 📈 / 🎬 tiers based on each clip's peak heat.
- **Keyboard shortcuts** (customisable at `chrome://extensions/shortcuts`):

  | Action             | Windows / Linux   | macOS               |
  | ------------------ | ----------------- | ------------------- |
  | Start Smart Reel   | `Alt+S`           | `⌘S`                |
  | Stop reel          | `Alt+X`           | `⌘X`                |
  | Next highlight     | `Alt+Shift+Right` | `⌘⇧→`               |
  | Previous highlight | `Alt+Shift+Left`  | `⌘⇧←`               |

> Not every video has a heatmap. YouTube only shows one once a video has enough views.

## Install (from source)

Requires Node.js 18+.

```bash
git clone https://github.com/itailiors/heatreel.git
cd heatreel
npm install
npm run build
```

Then in Chrome:

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and select the `.output/chrome-mv3` folder.
3. Open any YouTube video and click the HeatReel icon (or press `Alt+S`).

## Development

```bash
npm run dev      # watch build → .output/chrome-mv3-dev (load it unpacked)
npm run compile  # type-check
npm run zip      # package for the Chrome Web Store
```

Built with [WXT](https://wxt.dev), React and TypeScript (Manifest V3).

| Path                       | What it does                                                    |
| -------------------------- | --------------------------------------------------------------- |
| `entrypoints/content.ts`   | Heatmap extraction, clip selection, playback, overlay, comments |
| `entrypoints/popup/`       | The popup UI (React)                                            |
| `entrypoints/background.ts`| Keyboard shortcut relay (stateless MV3 service worker)          |
| `utils/`                   | Shared message types and shortcut labels                        |

## Privacy

HeatReel runs entirely in your browser. It collects no data, has no servers and makes no requests
other than to youtube.com itself. Comments are only posted when you click **Post to Comments**
(twice, to confirm).

## Contributing

Issues and pull requests are welcome. YouTube changes its page structure often, so reports of
broken heatmap detection or comment posting (with a video link) are especially helpful.

## License

[MIT](LICENSE)
