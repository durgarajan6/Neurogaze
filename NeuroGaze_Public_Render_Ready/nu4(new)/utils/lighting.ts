// ============================================================================
// LIGHTING MEASUREMENT
// ----------------------------------------------------------------------------
// Estimates the current camera lighting condition directly from the live
// WebGazer video feed (the <video> element WebGazer already attaches to
// #webgazerVideoContainer). No extra camera stream is opened - we simply
// draw the *existing* video frame onto a small offscreen canvas and read
// its pixel data back out with getImageData().
//
// Two independent numbers are produced from that pixel data:
//   - brightness: mean grayscale luminance of the frame (0-255)
//   - contrast:   standard deviation of that same luminance (0-255)
//
// Both are genuine per-frame measurements - nothing here is a hardcoded
// or randomly-generated value. The classification thresholds below are the
// only "assumptions" in this file, and they are exposed as named constants
// so they can be tuned/justified in the project report.
// ============================================================================

export type LightingCondition = 'normal' | 'low' | 'bright' | 'unstable' | 'unknown';

export interface LightingReading {
  brightness: number;      // 0-255, mean luminance of the sampled frame
  contrast: number;        // 0-255, stddev of luminance (detail/texture proxy)
  condition: LightingCondition;
  /** true when lighting is good enough that gaze samples should not be
   *  penalised for lighting reasons. Kept separate from `condition` so
   *  callers don't have to re-encode the same thresholds. */
  qualityOk: boolean;
  timestamp: number;
}

// Down-sampled analysis resolution. Small on purpose: sampling a 48x36
// canvas is cheap enough to run every few hundred ms without competing with
// WebGazer's own per-frame face tracking for CPU time.
const SAMPLE_WIDTH = 48;
const SAMPLE_HEIGHT = 36;

export const LIGHTING_CONFIG = {
  // Mean luminance (0-255) below which the scene is considered under-lit.
  LOW_BRIGHTNESS: 65,
  // Mean luminance above which the scene is considered over-exposed.
  HIGH_BRIGHTNESS: 205,
  // Below this stddev the frame is nearly flat (washed out / very dark),
  // which usually means the face has little usable detail for eye
  // detection even if mean brightness looks acceptable.
  MIN_CONTRAST: 15,
  // Number of recent brightness samples kept to judge flicker/instability.
  HISTORY_WINDOW: 6,
  // If the stddev of the last HISTORY_WINDOW brightness readings exceeds
  // this, lighting is classified 'unstable' (e.g. a flickering light,
  // someone walking past a window, screen glare changing).
  UNSTABLE_BRIGHTNESS_STD: 16,
};

export class LightingMonitor {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private brightnessHistory: number[] = [];

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = SAMPLE_WIDTH;
    this.canvas.height = SAMPLE_HEIGHT;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
  }

  reset() {
    this.brightnessHistory = [];
  }

  /**
   * Draws the current frame of `video` into a small offscreen canvas and
   * computes brightness/contrast from the raw pixel data. Returns null if
   * the video isn't ready yet (e.g. metadata not loaded) - callers should
   * treat that as "no reading available" rather than fabricating one.
   */
  sample(video: HTMLVideoElement | null): LightingReading | null {
    if (!video || !this.ctx) return null;
    if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) return null;

    try {
      this.ctx.drawImage(video, 0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
      const frame = this.ctx.getImageData(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT).data;

      let sum = 0;
      const luma: number[] = new Array(SAMPLE_WIDTH * SAMPLE_HEIGHT);
      const pixelCount = SAMPLE_WIDTH * SAMPLE_HEIGHT;

      for (let i = 0; i < pixelCount; i++) {
        const o = i * 4;
        // Standard Rec. 601 luma approximation
        const l = 0.299 * frame[o] + 0.587 * frame[o + 1] + 0.114 * frame[o + 2];
        luma[i] = l;
        sum += l;
      }

      const brightness = sum / pixelCount;
      let variance = 0;
      for (let i = 0; i < pixelCount; i++) {
        variance += Math.pow(luma[i] - brightness, 2);
      }
      const contrast = Math.sqrt(variance / pixelCount);

      // Track recent brightness values to detect instability/flicker
      this.brightnessHistory.push(brightness);
      if (this.brightnessHistory.length > LIGHTING_CONFIG.HISTORY_WINDOW) {
        this.brightnessHistory.shift();
      }

      const condition = this.classify(brightness, contrast);
      const qualityOk = condition === 'normal' || condition === 'bright';

      return {
        brightness: Math.round(brightness * 10) / 10,
        contrast: Math.round(contrast * 10) / 10,
        condition,
        qualityOk,
        timestamp: Date.now(),
      };
    } catch (e) {
      // Most commonly a transient "video not ready" / cross-origin canvas
      // read issue - fail closed (no reading) rather than guessing.
      console.warn('Lighting sample failed:', e);
      return null;
    }
  }

  private classify(brightness: number, contrast: number): LightingCondition {
    // Instability check first: even a "normal" mean brightness is unusable
    // for calibration if it keeps swinging wildly frame to frame.
    if (this.brightnessHistory.length >= LIGHTING_CONFIG.HISTORY_WINDOW) {
      const mean =
        this.brightnessHistory.reduce((a, b) => a + b, 0) / this.brightnessHistory.length;
      const variance =
        this.brightnessHistory.reduce((a, b) => a + Math.pow(b - mean, 2), 0) /
        this.brightnessHistory.length;
      const std = Math.sqrt(variance);
      if (std > LIGHTING_CONFIG.UNSTABLE_BRIGHTNESS_STD) return 'unstable';
    }

    if (brightness < LIGHTING_CONFIG.LOW_BRIGHTNESS) return 'low';
    if (brightness > LIGHTING_CONFIG.HIGH_BRIGHTNESS) return 'bright';
    if (contrast < LIGHTING_CONFIG.MIN_CONTRAST) return 'low'; // flat/washed-out frame
    return 'normal';
  }
}

/** Maps a lighting condition to a 0-1 score used by the tracking-quality
 *  formula in adaptiveEngine.ts. Documented here so the mapping lives next
 *  to the condition definitions it scores. */
export const lightingConditionScore = (condition: LightingCondition): number => {
  switch (condition) {
    case 'normal': return 1.0;
    case 'bright': return 0.7;
    case 'low': return 0.35;
    case 'unstable': return 0.3;
    default: return 0.6; // 'unknown' - no reading yet, treat as neutral
  }
};
