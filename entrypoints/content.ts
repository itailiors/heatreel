import type {
  Clip,
  CommentResponse,
  HeatmapSource,
  HighlightRequest,
  HighlightResponse,
  SmartStats,
} from '@/utils/messages';
import { DEFAULT_SHORTCUTS, tooltip, type Shortcuts } from '@/utils/shortcuts';

/**
 * HeatReel – content script.
 *
 * Note on `matches`: YouTube is an SPA. A user who lands on the home page and
 * then clicks a video never triggers a fresh page load on /watch, so a script
 * matching only `/watch*` would never be injected. We therefore inject on all
 * of youtube.com and gate every action on WATCH_PATTERN (the pattern WXT's docs
 * recommend for SPA sites).
 */
const WATCH_PATTERN = new MatchPattern('*://*.youtube.com/watch*');

interface HeatMarker {
  startMs: number;
  durationMs: number;
  /** 0..1 */
  intensity: number;
}

interface Heatmap {
  videoId: string;
  markers: HeatMarker[];
  source: HeatmapSource;
}

class NoHeatmapError extends Error {}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function currentVideoId(): string | null {
  try {
    return new URL(location.href).searchParams.get('v');
  } catch {
    return null;
  }
}

function isWatchPage(): boolean {
  return WATCH_PATTERN.includes(location.href);
}

function getVideo(): HTMLVideoElement | null {
  return (
    document.querySelector<HTMLVideoElement>('#movie_player video.html5-main-video') ??
    document.querySelector<HTMLVideoElement>('video')
  );
}

function isAdShowing(): boolean {
  return !!document.querySelector('#movie_player.ad-showing');
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

// ---------------------------------------------------------------------------
// ytInitialData extraction
// ---------------------------------------------------------------------------

/** Pull the `ytInitialData` JSON object out of a blob of HTML / script text. */
function parseYtInitialData(text: string): any | null {
  const marker = /(?:var\s+|window\[["'])ytInitialData["']?\]?\s*=\s*/;
  const m = marker.exec(text);
  if (!m) return null;
  const start = m.index + m[0].length;
  if (text[start] !== '{') return null;

  // Brace-match to find the end of the object literal (string-aware).
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function dataVideoId(data: any): string | null {
  return data?.currentVideoEndpoint?.watchEndpoint?.videoId ?? null;
}

/** Legacy format: playerOverlays → … → multiMarkersPlayerBarRenderer.markersMap */
function markersFromMarkersMap(data: any): HeatMarker[] {
  const markersMap: any[] =
    data?.playerOverlays?.playerOverlayRenderer?.decoratedPlayerBarRenderer
      ?.decoratedPlayerBarRenderer?.playerBar?.multiMarkersPlayerBarRenderer?.markersMap ?? [];
  if (!Array.isArray(markersMap)) return [];

  for (const entry of markersMap) {
    const heatMarkers: any[] | undefined =
      entry?.value?.heatmap?.heatmapRenderer?.heatMarkers;
    if (!Array.isArray(heatMarkers) || heatMarkers.length === 0) continue;

    const out: HeatMarker[] = [];
    for (const hm of heatMarkers) {
      const r = hm?.heatMarkerRenderer ?? hm;
      const startMs = num(r?.timeRangeStartMillis);
      const durationMs = num(r?.markerDurationMillis);
      const intensity = num(r?.heatMarkerIntensityScoreNormalized);
      if (startMs !== null && durationMs !== null && intensity !== null) {
        out.push({ startMs, durationMs, intensity });
      }
    }
    if (out.length) return out;
  }
  return [];
}

/** Current format: frameworkUpdates → … → macroMarkersListEntity.markersList */
function markersFromFrameworkUpdates(data: any): HeatMarker[] {
  const mutations: any[] = data?.frameworkUpdates?.entityBatchUpdate?.mutations ?? [];
  if (!Array.isArray(mutations)) return [];

  for (const mut of mutations) {
    const list = mut?.payload?.macroMarkersListEntity?.markersList;
    if (!list) continue;
    if (list?.markerType && list.markerType !== 'MARKER_TYPE_HEATMAP') continue;
    const markers: any[] | undefined = list?.markers;
    if (!Array.isArray(markers) || markers.length === 0) continue;

    const out: HeatMarker[] = [];
    for (const m of markers) {
      const startMs = num(m?.startMillis);
      const durationMs = num(m?.durationMillis);
      const intensity = num(m?.intensityScoreNormalized);
      if (startMs !== null && durationMs !== null && intensity !== null) {
        out.push({ startMs, durationMs, intensity });
      }
    }
    if (out.length) return out;
  }
  return [];
}

function markersFromData(data: any): HeatMarker[] {
  const legacy = markersFromMarkersMap(data);
  return legacy.length ? legacy : markersFromFrameworkUpdates(data);
}

/**
 * Content scripts run in an isolated world, so `window.ytInitialData` isn't
 * visible. On a hard page load the inline <script> still has it; after SPA
 * navigation that script is stale (it describes the first video), so we fetch
 * the watch page and parse a fresh copy instead.
 */
async function heatmapFromYtInitialData(videoId: string): Promise<HeatMarker[]> {
  // 1) Inline script – only trust it if it describes the current video.
  for (const script of Array.from(document.querySelectorAll('script'))) {
    const text = script.textContent ?? '';
    if (!text.includes('ytInitialData')) continue;
    const data = parseYtInitialData(text);
    if (data && dataVideoId(data) === videoId) {
      const markers = markersFromData(data);
      if (markers.length) return markers;
      // Correct video but no heatmap → it really has none; skip the fetch.
      return [];
    }
  }

  // 2) Fresh fetch of the watch page (same-origin, cookies included).
  try {
    const res = await fetch(`/watch?v=${encodeURIComponent(videoId)}`, {
      credentials: 'include',
    });
    if (!res.ok) return [];
    const data = parseYtInitialData(await res.text());
    return data ? markersFromData(data) : [];
  } catch (err) {
    console.debug('[highlights] watch-page fetch failed', err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// SVG fallback
// ---------------------------------------------------------------------------

/**
 * The player draws the heatmap as `<path class="ytp-heat-map-path" d="M 0,100 C …">`
 * in a viewBox of roughly 1000×100. Each cubic segment ends on a data point;
 * y = 100 means "no replays", y = 0 means "most replayed".
 */
function heatmapFromSvg(durationSec: number): HeatMarker[] {
  if (!(durationSec > 0)) return [];

  const paths = Array.from(document.querySelectorAll<SVGPathElement>('path.ytp-heat-map-path'));
  // With chapters, the same path can be rendered once per chapter segment.
  const uniqueD = Array.from(new Set(paths.map((p) => p?.getAttribute('d') ?? '').filter(Boolean)));
  const d = uniqueD[0];
  if (!d) return [];

  const svg = paths[0]?.ownerSVGElement;
  const vb = svg?.viewBox?.baseVal;
  const width = vb && vb.width > 0 ? vb.width : 1000;
  const height = vb && vb.height > 0 ? vb.height : 100;

  // Collect end-points of each C command (every third coordinate pair).
  const points: { x: number; y: number }[] = [];
  const segRe = /C\s*([^A-Za-z]+)/g;
  let seg: RegExpExecArray | null;
  while ((seg = segRe.exec(d))) {
    const nums = (seg[1] ?? '').match(/-?\d*\.?\d+/g)?.map(Number) ?? [];
    for (let i = 4; i + 1 < nums.length; i += 6) {
      const x = nums[i];
      const y = nums[i + 1];
      if (x !== undefined && y !== undefined) points.push({ x, y });
    }
  }
  if (points.length < 2) return [];

  const stepMs = (durationSec * 1000) / points.length;
  return points.map((p) => ({
    startMs: Math.max(0, (p.x / width) * durationSec * 1000 - stepMs / 2),
    durationMs: stepMs,
    intensity: Math.min(1, Math.max(0, (height - p.y) / height)),
  }));
}

// ---------------------------------------------------------------------------
// Heatmap loading + cache
// ---------------------------------------------------------------------------

let cache: Heatmap | null = null;
let inflight: { videoId: string; promise: Promise<Heatmap> } | null = null;

async function loadHeatmap(videoId: string): Promise<Heatmap> {
  if (cache?.videoId === videoId) return cache;
  if (inflight?.videoId === videoId) return inflight.promise;

  const promise = (async (): Promise<Heatmap> => {
    const fromData = await heatmapFromYtInitialData(videoId);
    if (fromData.length) return { videoId, markers: fromData, source: 'ytInitialData' };

    // The player may still be rendering; give the SVG a few chances.
    for (let attempt = 0; attempt < 5; attempt++) {
      if (currentVideoId() !== videoId) break;
      const fromSvg = heatmapFromSvg(getVideo()?.duration ?? NaN);
      if (fromSvg.length) return { videoId, markers: fromSvg, source: 'svg' };
      await sleep(600);
    }
    throw new NoHeatmapError(
      "We couldn't find a heatmap for this video yet. YouTube adds one once enough people have watched.",
    );
  })();

  inflight = { videoId, promise };
  try {
    const result = await promise;
    if (currentVideoId() === videoId) cache = result;
    return result;
  } finally {
    if (inflight?.promise === promise) inflight = null;
  }
}

/** Background pre-fetch on load / navigation. Never throws. */
function prefetch() {
  if (!isWatchPage()) return;
  const id = currentVideoId();
  if (!id) return;
  loadHeatmap(id).catch((err) => {
    if (!(err instanceof NoHeatmapError)) console.debug('[highlights] prefetch failed', err);
  });
}

// ---------------------------------------------------------------------------
// Clip selection
// ---------------------------------------------------------------------------

// ---- Smart mode: statistical threshold ----------------------------------

/** Seconds of lead-in added before each smart window. */
const SMART_PRE_BUFFER = 2;
/** Below this SD (on the 0..1 scale) the heatmap counts as flat. */
const SMART_MIN_SD = 0.05;
/** Flat-heatmap fallback: keep the top 15% of segments. */
const SMART_FALLBACK_TOP = 0.15;
/** Segments closer than this (s) are treated as adjacent and merged. */
const SMART_MERGE_GAP = 0.5;

function meanAndSd(xs: number[]): { mean: number; sd: number } {
  const n = xs.length;
  if (!n) return { mean: 0, sd: 0 };
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const variance = xs.reduce((a, x) => a + (x - mean) ** 2, 0) / n; // population SD
  return { mean, sd: Math.sqrt(variance) };
}

function smartClips(
  markers: HeatMarker[],
  durationSec: number,
): { clips: Clip[]; stats: SmartStats } {
  const scores = markers.map((m) => m.intensity);
  const { mean, sd } = meanAndSd(scores);

  let selected: HeatMarker[];
  let stats: SmartStats;

  if (sd >= SMART_MIN_SD) {
    const threshold = mean + sd;
    selected = markers.filter((m) => m.intensity >= threshold);
    stats = { mean, sd, threshold, method: 'mean+sd' };
  } else {
    // Flat heatmap: mean + SD would be noise. Take the top 15% by rank
    // (rank, not value, so a perfectly uniform map doesn't select everything).
    const k = Math.max(1, Math.ceil(markers.length * SMART_FALLBACK_TOP));
    selected = [...markers].sort((a, b) => b.intensity - a.intensity).slice(0, k);
    const threshold = Math.min(...selected.map((m) => m.intensity));
    stats = { mean, sd, threshold, method: 'percentile' };
  }

  return { clips: groupWindows(selected, videoLength(markers, durationSec)), stats };
}

function videoLength(markers: HeatMarker[], durationSec: number): number {
  return durationSec > 0
    ? durationSec
    : Math.max(...markers.map((m) => (m.startMs + m.durationMs) / 1000));
}

/**
 * Turn selected segments into windows with a pre-buffer, then merge
 * adjacent/overlapping ones into continuous clips (chronological order).
 */
function groupWindows(selected: HeatMarker[], total: number): Clip[] {
  const windows = selected
    .map((m) => ({
      start: Math.max(0, m.startMs / 1000 - SMART_PRE_BUFFER),
      end: Math.min(total, (m.startMs + m.durationMs) / 1000),
      intensity: m.intensity,
    }))
    .filter((w) => w.end > w.start)
    .sort((a, b) => a.start - b.start);

  const clips: Clip[] = [];
  for (const w of windows) {
    const last = clips[clips.length - 1];
    if (last && w.start <= last.end + SMART_MERGE_GAP) {
      last.end = Math.max(last.end, w.end);
      last.intensity = Math.max(last.intensity, w.intensity);
    } else {
      clips.push({ ...w });
    }
  }
  return clips;
}

/** Manual threshold: every segment at/above it, grouped like smart mode. */
function thresholdClips(
  markers: HeatMarker[],
  durationSec: number,
  threshold: number,
): { clips: Clip[]; stats: SmartStats } {
  const { mean, sd } = meanAndSd(markers.map((m) => m.intensity));
  const selected = markers.filter((m) => m.intensity >= threshold);
  return {
    clips: groupWindows(selected, videoLength(markers, durationSec)),
    stats: { mean, sd, threshold, method: 'custom' },
  };
}

// ---- Manual mode: top-N fixed-length peaks ------------------------------

function pickClips(
  markers: HeatMarker[],
  count: number,
  seconds: number,
  durationSec: number,
): Clip[] {
  const total = videoLength(markers, durationSec);
  const len = Math.min(seconds, total);
  // Start a little before the peak so the moment has some lead-in.
  const leadIn = len / 3;

  const ranked = [...markers].sort((a, b) => b.intensity - a.intensity);
  const chosen: Clip[] = [];

  for (const m of ranked) {
    if (chosen.length >= count) break;
    if (m.intensity <= 0) break;
    const peak = (m.startMs + m.durationMs / 2) / 1000;
    const start = Math.min(Math.max(0, peak - leadIn), Math.max(0, total - len));
    const end = start + len;
    // Skip markers that would overlap an already-chosen clip
    // (neighbouring markers usually belong to the same peak).
    if (chosen.some((c) => start < c.end && end > c.start)) continue;
    chosen.push({ start, end, intensity: m.intensity });
  }
  return chosen.sort((a, b) => a.start - b.start);
}

// ---------------------------------------------------------------------------
// Mini player overlay (lives inside the player so it shows in full screen)
// ---------------------------------------------------------------------------

/** Assigned keyboard shortcuts, for tooltips. Refreshed from the background on load. */
let shortcuts: Shortcuts = { ...DEFAULT_SHORTCUTS };

async function refreshShortcuts() {
  try {
    const res = (await browser.runtime.sendMessage({ type: 'GET_SHORTCUTS' })) as Shortcuts | undefined;
    if (res) shortcuts = { ...DEFAULT_SHORTCUTS, ...res };
  } catch {
    /* keep defaults */
  }
}

/** m:ss for the mini player timer. */
const clock = (sec: number) => {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const MINI_ID = 'heatreel-mini';
const MINI_FLASH_MS = 4000;

const MINI_CSS = `
  :host { all: initial; }
  .pill {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 4px 6px;
    background: rgba(0, 0, 0, 0.7);
    -webkit-backdrop-filter: blur(4px);
    backdrop-filter: blur(4px);
    border-radius: 20px;
    color: #fff;
    font: 500 13px/1 Roboto, 'YouTube Sans', Arial, sans-serif;
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.35);
    pointer-events: auto;
    user-select: none;
    animation: in 160ms ease-out;
  }
  @keyframes in { from { opacity: 0; transform: translateY(-4px); } }
  .label {
    padding: 0 8px;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  .label b { color: #ff6b6b; font-weight: 600; margin-right: 4px; }
  .timer { margin-left: 6px; opacity: 0.7; font-variant-numeric: tabular-nums; }
  .pill.message .timer { display: none; }
  button {
    all: unset;
    display: grid;
    place-items: center;
    min-width: 28px;
    height: 28px;
    border-radius: 14px;
    font-size: 14px;
    line-height: 1;
    cursor: pointer;
    pointer-events: auto;
    transition: background 120ms ease;
  }
  button:hover { background: rgba(255, 255, 255, 0.16); }
  button:active { background: rgba(255, 255, 255, 0.26); }
  .close { min-width: 22px; height: 22px; font-size: 11px; opacity: 0.6; margin-left: 2px; }
  .close:hover { opacity: 1; }
  .pill.message .nav { display: none; }
  /* YouTube enlarges its own controls in full screen; follow suit. */
  :host-context(.ytp-big-mode) .pill { font-size: 16px; padding: 6px 8px; }
  :host-context(.ytp-big-mode) button { min-width: 36px; height: 36px; border-radius: 18px; font-size: 18px; }
`;

/** Events that would otherwise reach YouTube's player (play/pause, fullscreen, seek). */
const SWALLOWED_EVENTS = [
  'click', 'dblclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup',
  'touchstart', 'touchend', 'contextmenu', 'wheel',
] as const;

const miniPlayer = (() => {
  let host: HTMLDivElement | null = null;
  let pill: HTMLDivElement | null = null;
  let label: HTMLSpanElement | null = null;
  let timer: HTMLSpanElement | null = null;
  let buttons: { prev: HTMLButtonElement; next: HTMLButtonElement; close: HTMLButtonElement } | null =
    null;
  let lastTimerText = '';
  let flashTimer: ReturnType<typeof setTimeout> | undefined;

  function button(cls: string, text: string, title: string, onClick: () => void) {
    const b = document.createElement('button');
    b.className = cls;
    b.textContent = text;
    b.title = title;
    b.tabIndex = -1; // never steal focus from YouTube's keyboard shortcuts
    b.setAttribute('aria-label', title);
    b.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    });
    return b;
  }

  function ensure(): boolean {
    const player = document.querySelector<HTMLElement>('.html5-video-player');
    if (!player) return false;
    if (host?.isConnected && host.parentElement === player) return true;
    host?.remove();

    host = document.createElement('div');
    host.id = MINI_ID;
    Object.assign(host.style, {
      position: 'absolute',
      top: '12px',
      right: '12px',
      zIndex: '9999',
      pointerEvents: 'none', // only the pill itself is interactive
    } satisfies Partial<CSSStyleDeclaration>);

    // Stop clicks/taps from bubbling to the player and pausing the video.
    for (const type of SWALLOWED_EVENTS) host.addEventListener(type, (e) => e.stopPropagation());
    // Keep the buttons from taking focus on mousedown.
    host.addEventListener('mousedown', (e) => e.preventDefault());

    const root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = MINI_CSS;

    pill = document.createElement('div');
    pill.className = 'pill';
    pill.setAttribute('role', 'group');
    pill.setAttribute('aria-label', 'HeatReel highlights');
    label = document.createElement('span');
    label.className = 'label';
    label.setAttribute('aria-live', 'polite');

    timer = document.createElement('span');
    timer.className = 'timer';
    lastTimerText = '';

    buttons = {
      prev: button('nav prev', '⏮️', tooltip('prev-highlight', shortcuts), () => prevClip()),
      next: button('nav next', '⏭️', tooltip('next-highlight', shortcuts), () => nextClip()),
      // ✖ stops the reel, matching its "Stop Reel" tooltip (stopReel also hides the pill).
      close: button('close', '✖', tooltip('stop-reel', shortcuts), () => stopReel(true)),
    };
    pill.append(buttons.prev, label, timer, buttons.next, buttons.close);
    root.append(style, pill);
    player.appendChild(host);
    return true;
  }

  function remove() {
    clearTimeout(flashTimer);
    host?.remove();
    host = pill = label = timer = null;
    buttons = null;
  }

  function setTitle(b: HTMLButtonElement, title: string) {
    if (b.title !== title) {
      b.title = title;
      b.setAttribute('aria-label', title);
    }
  }

  return {
    /** Show/refresh "Highlight X of Y". */
    show(index: number, total: number) {
      if (!ensure() || !pill || !label) return;
      clearTimeout(flashTimer);
      pill.classList.remove('message');
      label.innerHTML = '';
      const brand = document.createElement('b');
      brand.textContent = '🔥';
      label.append(brand, `Highlight ${index + 1} of ${total}`);
      if (buttons) {
        setTitle(buttons.prev, tooltip('prev-highlight', shortcuts));
        setTitle(buttons.next, tooltip('next-highlight', shortcuts));
        setTitle(buttons.close, tooltip('stop-reel', shortcuts));
      }
      const clip = reel.clips[index];
      if (clip) this.tick(0, clip.end - clip.start);
    },
    /** Live "(0:05 / 0:15)" for the current clip; only touches the DOM when it changes. */
    tick(elapsed: number, length: number) {
      if (!timer) return;
      const text = `(${clock(Math.min(Math.max(elapsed, 0), length))} / ${clock(length)})`;
      if (text !== lastTimerText) {
        timer.textContent = text;
        lastTimerText = text;
      }
    },
    /** A short message (e.g. an error from a keyboard shortcut), then back to normal. */
    flash(text: string) {
      if (!ensure() || !pill || !label) return;
      clearTimeout(flashTimer);
      pill.classList.add('message');
      label.textContent = text;
      flashTimer = setTimeout(() => {
        const clip = reel.clips[reel.index];
        if (reel.running && clip) this.show(reel.index, reel.clips.length);
        else remove();
      }, MINI_FLASH_MS);
    },
    hide: remove,
  };
})();

// ---------------------------------------------------------------------------
// Player control
// ---------------------------------------------------------------------------

const reel = {
  running: false,
  clips: [] as Clip[],
  index: -1,
  video: null as HTMLVideoElement | null,
  source: undefined as HeatmapSource | undefined,
  mode: undefined as 'smart' | 'manual' | undefined,
  stats: undefined as SmartStats | undefined,
};

function onTimeUpdate() {
  const v = reel.video;
  const clip = reel.clips[reel.index];
  if (!reel.running || !v || !clip) return;
  if (isAdShowing()) return; // the ad uses the same <video>; wait it out
  if (v.currentTime >= clip.end) {
    playClip(reel.index + 1);
    return;
  }
  miniPlayer.tick(v.currentTime - clip.start, clip.end - clip.start);
}

function onEnded() {
  if (reel.running) stopReel(true);
}

function playClip(i: number) {
  const v = reel.video;
  const clip = reel.clips[i];
  if (!v || !clip) {
    stopReel(true);
    return;
  }
  reel.index = i;
  v.currentTime = clip.start;
  v.play().catch((err) => console.debug('[highlights] play() rejected', err));
  miniPlayer.show(i, reel.clips.length);
}

/** Skip ahead; past the last clip the reel finishes. */
function nextClip(): boolean {
  if (!reel.running) return false;
  playClip(reel.index + 1);
  return true;
}

/** Go back one clip; on the first clip, restart it. */
function prevClip(): boolean {
  if (!reel.running) return false;
  playClip(Math.max(0, reel.index - 1));
  return true;
}

function startReel(
  video: HTMLVideoElement,
  clips: Clip[],
  source: HeatmapSource,
  mode: 'smart' | 'manual',
  stats?: SmartStats,
) {
  stopReel(false);
  reel.running = true;
  reel.clips = clips;
  reel.video = video;
  reel.source = source;
  reel.mode = mode;
  reel.stats = stats;
  video.addEventListener('timeupdate', onTimeUpdate);
  video.addEventListener('ended', onEnded);
  playClip(0);
}

function stopReel(pause: boolean) {
  const v = reel.video;
  if (v) {
    v.removeEventListener('timeupdate', onTimeUpdate);
    v.removeEventListener('ended', onEnded);
    if (pause && reel.running) v.pause();
  }
  reel.running = false;
  reel.index = -1;
  reel.video = null;
  miniPlayer.hide();
}

function status(): HighlightResponse {
  return {
    ok: true,
    running: reel.running,
    clips: reel.clips,
    current: reel.index,
    mode: reel.mode,
    videoId: currentVideoId(),
    source: reel.source,
    stats: reel.stats,
  };
}

// ---------------------------------------------------------------------------
// Post to comments
// ---------------------------------------------------------------------------

/** Poll `fn` until it returns something truthy, or give up after `timeoutMs`. */
async function waitFor<T>(fn: () => T | null | undefined | false, timeoutMs: number, everyMs = 200) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const v = fn();
      if (v) return v;
    } catch {
      /* DOM in flux – keep polling */
    }
    if (Date.now() >= deadline) return null;
    await sleep(everyMs);
  }
}

const isDisabled = (el: Element) =>
  el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true';

/** The top-level comment box lives in the comments header (not the reply boxes). */
const commentsHeader = () =>
  document.querySelector<HTMLElement>('ytd-comments ytd-comments-header-renderer') ??
  document.querySelector<HTMLElement>('ytd-comments');

async function postComment(text: string): Promise<CommentResponse> {
  if (!isWatchPage()) return { ok: false, message: 'Open a YouTube video to post a comment.' };
  if (!text.trim()) return { ok: false, message: 'There are no highlights to post yet.' };

  try {
    // 1) Comments lazy-load when scrolled into view.
    const findPlaceholder = () =>
      commentsHeader()?.querySelector<HTMLElement>(
        'ytd-comment-simplebox-renderer #placeholder-area, #placeholder-area',
      );
    if (!findPlaceholder()) {
      const section = document.querySelector<HTMLElement>('ytd-comments#comments');
      if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
      else window.scrollBy({ top: window.innerHeight, behavior: 'smooth' });
    }
    const placeholder = await waitFor(findPlaceholder, 10000);
    if (!placeholder) {
      const turnedOff = document.querySelector('ytd-comments ytd-message-renderer');
      return {
        ok: false,
        message: turnedOff
          ? 'Comments are turned off for this video, so we can’t post there.'
          : 'The comments haven’t loaded yet. Scroll down to them, then try again.',
      };
    }

    // 2) Activate the box.
    placeholder.scrollIntoView({ behavior: 'smooth', block: 'center' });
    placeholder.click();
    const editor = await waitFor(
      () => commentsHeader()?.querySelector<HTMLElement>('#contenteditable-root'),
      4000,
    );
    if (!editor) {
      return { ok: false, message: 'We couldn’t open the comment box. Are you signed in to YouTube?' };
    }
    if (editor.textContent?.trim()) {
      return { ok: false, message: 'You already have a draft in the comment box. Clear it, then try again.' };
    }

    // 3) Fill it. YouTube's editor is a white-space: pre-wrap contenteditable
    //    that reads plain text nodes with literal "\n" line breaks. execCommand
    //    ('insertText') would turn each line into <div>/<br> blocks, which
    //    YouTube re-serialises badly (split lines, lost emojis), so write one
    //    text node directly and tell Polymer about it with an input event.
    editor.focus();
    editor.replaceChildren(document.createTextNode(text.replace(/\r\n?/g, '\n')));
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false); // caret at the end, as if typed
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    editor.dispatchEvent(
      new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: text }),
    );
    editor.dispatchEvent(new Event('change', { bubbles: true, composed: true }));

    // 4) Submit once Polymer has enabled the button.
    const submit = await waitFor(() => {
      const host = commentsHeader()?.querySelector<HTMLElement>('#submit-button');
      const btn = host?.querySelector<HTMLElement>('button') ?? host;
      return btn && !isDisabled(btn) && !(host && isDisabled(host)) ? btn : null;
    }, 3000);
    if (!submit) {
      return { ok: false, message: 'YouTube didn’t accept the comment. Your text is still in the box, so you can post it by hand.' };
    }
    submit.click();

    // 5) The box empties/closes once the comment is sent.
    const cleared = await waitFor(
      () => !commentsHeader()?.querySelector('#contenteditable-root')?.textContent?.trim(),
      6000,
    );
    return {
      ok: true,
      message: cleared ? 'Posted! Your highlights are now in the comments. 🎉' : 'Sent! It may take a moment to show up in the comments.',
    };
  } catch (err) {
    console.error('[HeatReel] post comment failed', err);
    return {
      ok: false,
      message: 'Something went wrong while posting. Give it another try.',
    };
  }
}

// ---------------------------------------------------------------------------
// Message handling
// ---------------------------------------------------------------------------

async function handle(msg: HighlightRequest): Promise<HighlightResponse | CommentResponse> {
  switch (msg?.type) {
    case 'POST_COMMENT':
      return postComment(String(msg.text ?? ''));

    case 'GET_STATUS':
      return status();

    case 'NEXT_CLIP':
    case 'PREV_CLIP': {
      const moved = msg.type === 'NEXT_CLIP' ? nextClip() : prevClip();
      return moved
        ? status()
        : { ok: false, error: 'NOT_RUNNING', message: 'No reel is playing right now. Start one first!' };
    }

    case 'STOP_HIGHLIGHTS':
      stopReel(true);
      return status();

    case 'START_HIGHLIGHTS': {
      const mode = msg.mode === 'manual' ? 'manual' : 'smart';
      let count = 0;
      let seconds = 0;
      let minHeat = 0;
      if (msg.mode === 'manual') {
        count = Math.floor(Number(msg.count));
        seconds = Number(msg.seconds);
        minHeat = msg.minHeatThreshold == null ? 0 : Number(msg.minHeatThreshold);
        const thresholdOk = minHeat >= 0 && minHeat <= 1;
        // With a threshold, count/seconds are ignored, so don't validate them.
        const limitsOk = minHeat > 0 || (count >= 1 && count <= 50 && seconds >= 1 && seconds <= 600);
        if (!thresholdOk || !limitsOk) {
          return {
            ok: false,
            error: 'BAD_REQUEST',
            message: 'Those settings look a bit off: try 1–50 highlights, 1–600 seconds, and a 0–100% threshold.',
          };
        }
      }
      if (!isWatchPage()) {
        return { ok: false, error: 'NOT_WATCH_PAGE', message: 'Open a YouTube video, then start your reel.' };
      }
      const videoId = currentVideoId();
      const video = getVideo();
      if (!videoId || !video) {
        return { ok: false, error: 'NO_VIDEO', message: 'We couldn’t find the video player. Try refreshing the page.' };
      }
      if (isAdShowing()) {
        return { ok: false, error: 'AD_PLAYING', message: 'An ad is playing. Start your reel once it’s over!' };
      }

      const heatmap = await loadHeatmap(videoId); // throws NoHeatmapError

      if (mode === 'smart') {
        const { clips, stats } = smartClips(heatmap.markers, video.duration);
        if (!clips.length) throw new NoHeatmapError('This video’s heatmap is still empty, so there’s nothing to highlight yet.');
        startReel(video, clips, heatmap.source, 'smart', stats);
      } else if (minHeat > 0) {
        const { clips, stats } = thresholdClips(heatmap.markers, video.duration, minHeat);
        if (!clips.length) {
          throw new NoHeatmapError(
            `No moments reach ${Math.round(minHeat * 100)}% heat. Try a lower threshold.`,
          );
        }
        startReel(video, clips, heatmap.source, 'manual', stats);
      } else {
        const clips = pickClips(heatmap.markers, count, seconds, video.duration);
        if (!clips.length) throw new NoHeatmapError('This video’s heatmap is still empty, so there’s nothing to highlight yet.');
        startReel(video, clips, heatmap.source, 'manual');
      }
      return status();
    }

    default:
      return { ok: false, error: 'BAD_REQUEST', message: 'HeatReel didn’t understand that request. Try updating the extension.' };
  }
}

/**
 * Run a request and always produce a response (never throws). Failures that
 * came from somewhere without its own UI (shortcuts, the player button) are
 * shown in the player.
 */
async function run(
  msg: HighlightRequest,
  surfaceErrors: boolean,
): Promise<HighlightResponse | CommentResponse> {
  let res: HighlightResponse | CommentResponse;
  try {
    res = await handle(msg);
  } catch (err: unknown) {
    if (err instanceof NoHeatmapError) {
      res = { ok: false, error: 'NO_HEATMAP', message: err.message };
    } else {
      console.error('[HeatReel] handler error', err);
      res = {
        ok: false,
        error: 'UNKNOWN',
        message: 'Something unexpected happened. Refresh the page and try again.',
      };
    }
  }
  if (!res.ok && surfaceErrors) miniPlayer.flash(res.message);
  return res;
}

// ---------------------------------------------------------------------------
// Native "Start HeatReel" button in YouTube's player controls
// ---------------------------------------------------------------------------

const NATIVE_BTN_ID = 'heatreel-native-start';

// Flame icon drawn in YouTube's 36×36 control-icon grid.
const FLAME_SVG = `
<svg height="100%" width="100%" viewBox="0 0 36 36" aria-hidden="true" focusable="false">
  <path fill="#fff" d="M18.2 7.5c.7 3.6-1.1 5.6-2.9 7.6-1.7 1.9-3.4 3.9-3.4 7.1 0 3.6 2.8 6.3 6.1 6.3s6.1-2.7 6.1-6.3c0-2.6-1.2-4.6-2.6-6.2.1 1.7-.6 3.1-1.9 3.7.6-4.6-.8-9.1-1.4-12.2zm-.3 13.2c.9 1.3 2.2 2.4 2.2 4.1 0 1.3-1 2.3-2.2 2.3s-2.2-1-2.2-2.3c0-1.7 1.3-2.8 2.2-4.1z"/>
</svg>`;

// An inline <svg> sits on the text baseline, which pushes it to the bottom
// of the button on YouTube's current controls. Centre it with flexbox and
// size it to match the neighbouring icons (set via --heatreel-icon).
const NATIVE_BTN_CSS = `
  #${NATIVE_BTN_ID} {
    display: inline-flex !important;
    align-items: center;
    justify-content: center;
    padding: 0 !important;
    vertical-align: top;
  }
  #${NATIVE_BTN_ID} svg {
    display: block;
    flex: none;
    width: var(--heatreel-icon, 100%);
    height: var(--heatreel-icon, 100%);
  }
`;

function ensureNativeButtonStyle() {
  const id = `${NATIVE_BTN_ID}-style`;
  if (document.getElementById(id)) return;
  const style = document.createElement('style');
  style.id = id;
  style.textContent = NATIVE_BTN_CSS;
  (document.head ?? document.documentElement).appendChild(style);
}

/** Copy the icon size of a neighbouring YouTube button, if it's smaller than ours. */
function matchNeighbourIconSize(btn: HTMLButtonElement) {
  const sibling = btn.parentElement?.querySelector<SVGElement>(
    `.ytp-button:not(#${NATIVE_BTN_ID}) svg`,
  );
  const size = sibling?.getBoundingClientRect();
  const box = btn.getBoundingClientRect();
  if (!size || !size.width || !box.height) return; // controls not laid out yet
  const px = Math.round(Math.min(size.width, size.height));
  // Only override when the neighbours use a fixed-size icon smaller than the button.
  const value = px < Math.min(box.width, box.height) - 1 ? `${px}px` : '';
  if (btn.style.getPropertyValue('--heatreel-icon') !== value) {
    if (value) btn.style.setProperty('--heatreel-icon', value);
    else btn.style.removeProperty('--heatreel-icon');
  }
}

function ensureNativeButton() {
  const existing = document.getElementById(NATIVE_BTN_ID) as HTMLButtonElement | null;
  if (!isWatchPage()) {
    existing?.remove();
    return;
  }
  const title = tooltip('start-smart-reel', shortcuts);
  if (existing?.isConnected) {
    matchNeighbourIconSize(existing);
    if (existing.title !== title) {
      existing.title = title;
      existing.setAttribute('aria-label', title);
    }
    return;
  }

  // Bottom-right controls are always visible on the watch page; the top
  // buttons only show in full screen/embeds, so they're the fallback.
  const container =
    document.querySelector<HTMLElement>('#movie_player .ytp-right-controls') ??
    document.querySelector<HTMLElement>('#movie_player .ytp-chrome-top-buttons');
  if (!container) return;

  const btn = document.createElement('button');
  btn.id = NATIVE_BTN_ID;
  btn.className = 'ytp-button'; // inherits YouTube's sizing, hover and auto-hide
  btn.title = title;
  btn.setAttribute('aria-label', title);
  btn.innerHTML = FLAME_SVG;
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation(); // don't let the player treat it as a play/pause click
    void run({ type: 'START_HIGHLIGHTS', mode: 'smart' }, true);
  });
  ensureNativeButtonStyle();
  container.prepend(btn);
  matchNeighbourIconSize(btn);
}

export default defineContentScript({
  matches: ['*://*.youtube.com/*'],
  main(ctx) {
    browser.runtime.onMessage.addListener((msg: HighlightRequest, _sender, sendResponse) => {
      // Shortcuts have no popup, so surface their failures in the player.
      const fromShortcut = ['START_HIGHLIGHTS', 'NEXT_CLIP', 'PREV_CLIP'].includes(msg?.type);
      run(msg, fromShortcut).then(sendResponse); // run() never rejects
      return true; // keep the port open for the async sendResponse
    });

    // Tooltips: fetch the real shortcut keys, then keep the player button in
    // place. YouTube rebuilds its controls on navigation, so re-check every
    // second (one querySelector – cheaper than observing the whole page).
    refreshShortcuts().finally(ensureNativeButton);
    ctx.setInterval(ensureNativeButton, 1000);

    // Initial load
    prefetch();

    // SPA navigation: stop any running reel (it belongs to the old video),
    // drop the stale cache and pre-fetch the new heatmap.
    let lastVideoId = currentVideoId();
    ctx.addEventListener(window, 'wxt:locationchange', () => {
      const id = currentVideoId();
      if (id === lastVideoId) return; // e.g. only a query param changed
      lastVideoId = id;
      stopReel(false);
      reel.clips = [];
      reel.mode = undefined;
      reel.stats = undefined;
      cache = null;
      prefetch();
      ensureNativeButton();
    });

    ctx.onInvalidated(() => {
      stopReel(false);
      document.getElementById(NATIVE_BTN_ID)?.remove();
      document.getElementById(`${NATIVE_BTN_ID}-style`)?.remove();
    });
  },
});
