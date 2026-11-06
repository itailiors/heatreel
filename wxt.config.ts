import { defineConfig } from 'wxt';

// See https://wxt.dev/api/reference/wxt/interfaces/inlineconfig.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'HeatReel',
    description: 'Play the "Most Replayed" moments of a YouTube video as a highlight reel.',
    // Lets the popup and keyboard shortcuts read the active tab's URL.
    permissions: ['activeTab'],
    // Chrome rejects the manifest if more than 4 commands have a suggested_key,
    // so "open popup" ships without a default (assign it at chrome://extensions/shortcuts).
    commands: {
      _execute_action: {
        description: 'Open HeatReel',
      },
      'start-smart-reel': {
        suggested_key: { default: 'Alt+S', mac: 'Command+S' },
        description: 'Instantly start the Smart Auto Reel',
      },
      'stop-reel': {
        suggested_key: { default: 'Alt+X', mac: 'Command+X' },
        description: 'Instantly stop the reel',
      },
      'next-highlight': {
        suggested_key: { default: 'Alt+Shift+Right', mac: 'Command+Shift+Right' },
        description: 'Skip to next highlight',
      },
      'prev-highlight': {
        suggested_key: { default: 'Alt+Shift+Left', mac: 'Command+Shift+Left' },
        description: 'Go to previous highlight',
      },
    },
  },
  // Don't auto-launch a browser on `npm run dev`; load .output/chrome-mv3-dev manually.
  webExt: {
    disabled: true,
  },
});
