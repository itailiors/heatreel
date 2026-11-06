// Tooltip labels and default keys for HeatReel's keyboard commands.
// The real keys can differ (macOS defaults, or the user remapped them at
// chrome://extensions/shortcuts), so callers fetch them and fall back to these.

export type CommandName = 'start-smart-reel' | 'stop-reel' | 'next-highlight' | 'prev-highlight';

export type Shortcuts = Record<CommandName, string>;

export const DEFAULT_SHORTCUTS: Shortcuts = {
  'start-smart-reel': 'Alt+S',
  'stop-reel': 'Alt+X',
  'next-highlight': 'Alt+Shift+Right',
  'prev-highlight': 'Alt+Shift+Left',
};

export const COMMAND_LABELS: Record<CommandName, string> = {
  'start-smart-reel': 'Start Smart Reel',
  'stop-reel': 'Stop Reel',
  'next-highlight': 'Next Highlight',
  'prev-highlight': 'Previous Highlight',
};

/** "Start Smart Reel (Alt+S)", or just the label if no key is assigned. */
export function tooltip(command: CommandName, keys: Partial<Shortcuts>): string {
  const key = keys[command];
  return key ? `${COMMAND_LABELS[command]} (${key})` : COMMAND_LABELS[command];
}

/** Merge chrome.commands.getAll() output over the defaults. */
export function shortcutsFrom(cmds: { name?: string; shortcut?: string }[]): Shortcuts {
  const out: Shortcuts = { ...DEFAULT_SHORTCUTS };
  for (const c of cmds) {
    if (c.name && c.name in out) out[c.name as CommandName] = c.shortcut ?? '';
  }
  return out;
}
