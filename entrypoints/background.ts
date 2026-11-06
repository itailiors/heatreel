import type { BackgroundRequest, HighlightRequest, HighlightResponse } from '@/utils/messages';
import { shortcutsFrom } from '@/utils/shortcuts';

const WATCH_URL = /^https?:\/\/([^/]+\.)?youtube\.com\/watch/;

/** Keyboard command → message sent to the active YouTube tab. */
const COMMANDS: Record<string, HighlightRequest> = {
  'start-smart-reel': { type: 'START_HIGHLIGHTS', mode: 'smart' },
  'stop-reel': { type: 'STOP_HIGHLIGHTS' },
  'next-highlight': { type: 'NEXT_CLIP' },
  'prev-highlight': { type: 'PREV_CLIP' },
};

// Stateless on purpose: MV3 service workers can be killed at any time.
export default defineBackground(() => {
  // Content scripts can't call browser.commands, so they ask here.
  browser.runtime.onMessage.addListener((msg: BackgroundRequest, _sender, sendResponse) => {
    if (msg?.type !== 'GET_SHORTCUTS') return; // not ours
    browser.commands
      .getAll()
      .then((cmds) => sendResponse(shortcutsFrom(cmds)))
      .catch(() => sendResponse(shortcutsFrom([])));
    return true; // async sendResponse
  });

  browser.commands.onCommand.addListener(async (command) => {
    const msg = COMMANDS[command];
    if (!msg) return;

    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (tab?.id == null) return;
      // activeTab is granted by the shortcut, so tab.url is readable here.
      if (!tab.url || !WATCH_URL.test(tab.url)) return;

      const res = (await browser.tabs.sendMessage(tab.id, msg)) as HighlightResponse | undefined;
      if (res && !res.ok) console.info(`[HeatReel] ${command} failed:`, res.message);
    } catch (err) {
      // Usually "Receiving end does not exist": the tab predates the extension.
      console.info('[HeatReel] could not reach the page:', err);
    }
  });
});
