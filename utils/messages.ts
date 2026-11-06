// Shared message contract between the popup and the content script.

export type HighlightRequest =
  /** Zero-config: statistical threshold (mean + SD) over the whole heatmap. */
  | { type: 'START_HIGHLIGHTS'; mode: 'smart' }
  /** Advanced overrides: top-N peaks of fixed length, optionally above a minimum heat. */
  | {
      type: 'START_HIGHLIGHTS';
      mode: 'manual';
      count: number;
      seconds: number;
      /**
       * Minimum normalized heat 0..1. When > 0, `count` and `seconds` are
       * ignored and every segment above it is grouped into windows.
       */
      minHeatThreshold?: number;
    }
  | { type: 'STOP_HIGHLIGHTS' }
  | { type: 'GET_STATUS' }
  | { type: 'NEXT_CLIP' }
  | { type: 'PREV_CLIP' }
  | { type: 'POST_COMMENT'; text: string };

export type CommentResponse = { ok: true; message: string } | { ok: false; message: string };

export interface Clip {
  /** Clip start, seconds. */
  start: number;
  /** Clip end, seconds. */
  end: number;
  /** Peak score: max normalized heat (0..1) of any segment inside this clip window. */
  intensity: number;
}

/** How the smart threshold was derived – shown in the popup. */
export interface SmartStats {
  mean: number;
  sd: number;
  threshold: number;
  /** 'custom' = the user's Advanced Settings threshold. */
  method: 'mean+sd' | 'percentile' | 'custom';
}

export type HighlightErrorCode =
  | 'NO_HEATMAP'
  | 'NO_VIDEO'
  | 'NOT_WATCH_PAGE'
  | 'AD_PLAYING'
  | 'BAD_REQUEST'
  | 'NOT_RUNNING'
  | 'UNKNOWN';

export type HeatmapSource = 'ytInitialData' | 'svg';

export type HighlightResponse =
  | {
      ok: true;
      running: boolean;
      clips: Clip[];
      /** Index of the clip currently playing (-1 when idle). */
      current: number;
      mode?: 'smart' | 'manual';
      /** YouTube video ID of the page, for building timestamp links. */
      videoId?: string | null;
      source?: HeatmapSource;
      stats?: SmartStats;
    }
  | { ok: false; error: HighlightErrorCode; message: string };

/** Content script → background: which keys are assigned to our commands? */
export type BackgroundRequest = { type: 'GET_SHORTCUTS' };
