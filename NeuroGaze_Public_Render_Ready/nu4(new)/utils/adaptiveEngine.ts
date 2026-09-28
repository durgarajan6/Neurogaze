import { LightingCondition, lightingConditionScore } from './lighting';

// ============================================================================
// CONFIGURATION
// ----------------------------------------------------------------------------
// Every threshold used by the adaptive-calibration system lives here so it
// can be justified/tuned in one place instead of being scattered through the
// UI code. Values are chosen conservatively (biased toward NOT updating the
// model) because a bad automatic correction is worse than no correction.
// ============================================================================
export const ADAPTIVE_CONFIG = {
  // --- Reliable-sample classification ---
  // A sample is rejected outright if tracking quality is below this score.
  MIN_TRACKING_QUALITY_FOR_SAMPLE: 45,
  // Max allowed pixel dispersion between consecutive raw gaze points for
  // the head to be considered "stable" for that sample.
  MAX_HEAD_MOVEMENT_PX: 45,
  // Gaze coordinates within this many px of the viewport are still counted
  // as "valid" (mirrors the existing outlier filter in EyeTrackingContext).
  BOUNDS_MARGIN_PX: 0,

  // --- Micro-calibration / adaptive update ---
  // Minimum number of *reliable* samples required before an offset
  // correction is computed. Below this, we refuse to update the model and
  // report "Insufficient valid samples" instead of fabricating a number.
  MIN_RELIABLE_SAMPLES_FOR_UPDATE: 6,
  // Any single correction is capped at this many pixels (per axis) so one
  // noisy micro-calibration cycle cannot throw the mapping far off.
  MAX_CORRECTION_PX: 150,
  // A validated correction is rolled back if the *after* error is worse
  // than the *before* error by more than this ratio (safety net against
  // model corruption from a bad correction).
  ROLLBACK_IF_WORSE_RATIO: 1.05,

  // --- Drift detection ---
  // Drift is flagged when the most recent measured error exceeds the
  // baseline (post-validation) error by this ratio...
  DRIFT_ERROR_RATIO: 1.35,
  // ...and it must hold for this many consecutive measurements, to avoid
  // reacting to a single noisy reading.
  DRIFT_CONSECUTIVE_MEASUREMENTS: 2,
  // A systematic (i.e. one-directional, not just noisy) offset on either
  // axis larger than this, sustained across the recent window, is also
  // treated as drift even if total error hasn't crossed DRIFT_ERROR_RATIO.
  DRIFT_SYSTEMATIC_OFFSET_PX: 60,
  // How many recent drift measurements are kept/considered.
  DRIFT_WINDOW: 5,
};

// ============================================================================
// TRACKING QUALITY
// ============================================================================
export interface TrackingQualitySignals {
  /** WebGazer produced a non-null prediction for this frame/window */
  detectionRate: number; // 0-1, fraction of recent frames with a face+eyes prediction
  /** Fraction of recent frames whose raw coordinates fell inside the
   *  viewport without needing edge-correction/clamping */
  gazeValidRate: number; // 0-1
  /** 1 = perfectly still, 0 = large recent dispersion */
  stability: number; // 0-1
  lighting: LightingCondition;
  /** ms since the last frame with a valid detection (0 = this frame) */
  msSinceLastDetection: number;
  /** best-effort separate eye-landmark signal; see comment in
   *  computeTrackingQuality for why this can fall back to detectionRate */
  eyesDetected: boolean;
}

export interface TrackingQualityResult {
  score: number; // 0-100
  status: {
    faceDetected: boolean;
    eyesDetected: boolean;
    gazeValid: boolean;
    lightingOk: boolean;
  };
}

// Weights used to combine sub-scores into the final 0-100 tracking-quality
// score. They sum to 1. Documented rationale:
//  - detection (35%): the single biggest determinant of whether *any*
//    gaze estimate exists at all this instant.
//  - gazeValidity (20%): even with a detection, wildly out-of-bounds
//    coordinates indicate an unreliable estimate.
//  - stability (20%): head movement is a well-known source of webcam
//    gaze-estimation error.
//  - lighting (15%): affects the underlying face/eye detector's accuracy.
//  - continuity (10%): penalises recent tracking loss even if the current
//    frame looks fine, since a just-recovered lock is often still noisy.
const QUALITY_WEIGHTS = {
  detection: 0.35,
  gazeValidity: 0.20,
  stability: 0.20,
  lighting: 0.15,
  continuity: 0.10,
};

const CONTINUITY_WINDOW_MS = 2000;

export function computeTrackingQuality(signals: TrackingQualitySignals): TrackingQualityResult {
  const detectionScore = clamp01(signals.detectionRate);
  const validityScore = clamp01(signals.gazeValidRate);
  const stabilityScore = clamp01(signals.stability);
  const lightingScore = lightingConditionScore(signals.lighting);
  const continuityScore = clamp01(1 - signals.msSinceLastDetection / CONTINUITY_WINDOW_MS);

  const score =
    100 *
    (detectionScore * QUALITY_WEIGHTS.detection +
      validityScore * QUALITY_WEIGHTS.gazeValidity +
      stabilityScore * QUALITY_WEIGHTS.stability +
      lightingScore * QUALITY_WEIGHTS.lighting +
      continuityScore * QUALITY_WEIGHTS.continuity);

  return {
    score: Math.round(clamp(score, 0, 100)),
    status: {
      faceDetected: signals.detectionRate > 0.5,
      // See classifySample() / EyeTrackingContext for how eyesDetected is
      // actually derived. Falls back to the same signal as faceDetected
      // when WebGazer's tracker doesn't expose separate eye landmarks.
      eyesDetected: signals.eyesDetected,
      gazeValid: validityScore > 0.5,
      lightingOk: lightingScore >= 0.7,
    },
  };
}

// ============================================================================
// RELIABLE-SAMPLE CLASSIFICATION
// ============================================================================
export type RejectionReason =
  | 'face_not_detected'
  | 'low_confidence'
  | 'excessive_head_movement'
  | 'poor_lighting'
  | 'invalid_gaze_coordinates'
  | null;

export interface SampleClassification {
  reliable: boolean;
  reason: RejectionReason;
}

export interface SampleClassificationInput {
  predictionAvailable: boolean;
  gazeX: number;
  gazeY: number;
  screenW: number;
  screenH: number;
  headMovementPx: number; // dispersion of last few raw points
  lighting: LightingCondition;
  trackingQualityScore: number; // 0-100, from computeTrackingQuality
}

/**
 * Decides whether a single gaze sample is trustworthy enough to be used by
 * the adaptive calibration model. Order matters: we report the *first*
 * applicable reason so the UI/log can explain rejections meaningfully
 * rather than just saying "rejected".
 */
export function classifySample(input: SampleClassificationInput): SampleClassification {
  if (!input.predictionAvailable) {
    return { reliable: false, reason: 'face_not_detected' };
  }
  if (
    !isFinite(input.gazeX) ||
    !isFinite(input.gazeY) ||
    input.gazeX < -ADAPTIVE_CONFIG.BOUNDS_MARGIN_PX ||
    input.gazeX > input.screenW + ADAPTIVE_CONFIG.BOUNDS_MARGIN_PX ||
    input.gazeY < -ADAPTIVE_CONFIG.BOUNDS_MARGIN_PX ||
    input.gazeY > input.screenH + ADAPTIVE_CONFIG.BOUNDS_MARGIN_PX
  ) {
    return { reliable: false, reason: 'invalid_gaze_coordinates' };
  }
  if (input.lighting === 'low' || input.lighting === 'unstable') {
    return { reliable: false, reason: 'poor_lighting' };
  }
  if (input.headMovementPx > ADAPTIVE_CONFIG.MAX_HEAD_MOVEMENT_PX) {
    return { reliable: false, reason: 'excessive_head_movement' };
  }
  if (input.trackingQualityScore < ADAPTIVE_CONFIG.MIN_TRACKING_QUALITY_FOR_SAMPLE) {
    return { reliable: false, reason: 'low_confidence' };
  }
  return { reliable: true, reason: null };
}

// ============================================================================
// OFFSET CORRECTION (used by both the initial 9-point flow's micro-checks
// and by Study.tsx's break-time micro-calibration)
// ============================================================================
export interface CorrectionResult {
  valid: boolean;
  reason?: string;
  dx: number;
  dy: number;
  error: number; // px, distance from target to sample centroid BEFORE correction
  dispersion: number; // px, spread of the samples used
  sampleCount: number;
}

/**
 * Computes a bias-correction (dx, dy) from a set of reliable gaze samples
 * collected while the user looks at a known (targetX, targetY). This is
 * the same "centroid vs target" approach used by calibration validation,
 * generalised into a reusable function. IQR-based outlier trimming removes
 * blinks/saccades that slipped through into the buffer.
 */
export function computeCorrection(
  samples: Array<{ x: number; y: number }>,
  targetX: number,
  targetY: number
): CorrectionResult {
  if (samples.length < ADAPTIVE_CONFIG.MIN_RELIABLE_SAMPLES_FOR_UPDATE) {
    return { valid: false, reason: 'Insufficient valid samples', dx: 0, dy: 0, error: 0, dispersion: 0, sampleCount: samples.length };
  }

  const centerDistances = samples.map((s) => Math.hypot(s.x - targetX, s.y - targetY));
  const sorted = [...centerDistances].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.25)];
  const q3 = sorted[Math.floor(sorted.length * 0.75)];
  const iqr = q3 - q1;
  const maxCutoff = Math.max(160, q3 + 1.5 * iqr);

  const validSamples = samples.filter((s, i) => centerDistances[i] < maxCutoff);
  if (validSamples.length < ADAPTIVE_CONFIG.MIN_RELIABLE_SAMPLES_FOR_UPDATE) {
    return { valid: false, reason: 'Insufficient valid samples', dx: 0, dy: 0, error: 0, dispersion: 0, sampleCount: validSamples.length };
  }

  const meanX = validSamples.reduce((s, p) => s + p.x, 0) / validSamples.length;
  const meanY = validSamples.reduce((s, p) => s + p.y, 0) / validSamples.length;
  const dx = meanX - targetX;
  const dy = meanY - targetY;
  const error = Math.hypot(dx, dy);

  const spreadX = Math.max(...validSamples.map((s) => s.x)) - Math.min(...validSamples.map((s) => s.x));
  const spreadY = Math.max(...validSamples.map((s) => s.y)) - Math.min(...validSamples.map((s) => s.y));
  const dispersion = spreadX + spreadY;

  // Safety cap - never propose a correction larger than the configured max
  const cappedDx = clamp(dx, -ADAPTIVE_CONFIG.MAX_CORRECTION_PX, ADAPTIVE_CONFIG.MAX_CORRECTION_PX);
  const cappedDy = clamp(dy, -ADAPTIVE_CONFIG.MAX_CORRECTION_PX, ADAPTIVE_CONFIG.MAX_CORRECTION_PX);

  return {
    valid: true,
    dx: cappedDx,
    dy: cappedDy,
    error,
    dispersion,
    sampleCount: validSamples.length,
  };
}

/** Percentage improvement between a before/after error pair, or null when
 *  there isn't enough data to say anything meaningful. Never fabricated. */
export function computeImprovement(beforeError: number, afterError: number, sampleCountBefore: number, sampleCountAfter: number): number | null {
  if (
    sampleCountBefore < ADAPTIVE_CONFIG.MIN_RELIABLE_SAMPLES_FOR_UPDATE ||
    sampleCountAfter < ADAPTIVE_CONFIG.MIN_RELIABLE_SAMPLES_FOR_UPDATE ||
    beforeError <= 0
  ) {
    return null;
  }
  return ((beforeError - afterError) / beforeError) * 100;
}

// ============================================================================
// DRIFT DETECTION
// ----------------------------------------------------------------------------
// "Drift" here means: the gaze-error measured at a known target (e.g. the
// centre dot shown between study images) has become meaningfully worse than
// the error measured right after calibration validation - OR a consistent
// one-directional offset has appeared. Both are statistical comparisons
// against a stored baseline, never a fixed timer.
// ============================================================================
export interface DriftMeasurement {
  timestamp: number;
  error: number;
  dx: number;
  dy: number;
}

export interface DriftResult {
  drifted: boolean;
  reason: 'error_ratio' | 'systematic_offset' | null;
  baselineError: number | null;
  recentError: number | null;
}

export class DriftDetector {
  private baseline: { error: number; dx: number; dy: number } | null = null;
  private history: DriftMeasurement[] = [];

  reset() {
    this.baseline = null;
    this.history = [];
  }

  setBaseline(error: number, dx: number, dy: number) {
    this.baseline = { error, dx, dy };
    this.history = [];
  }

  getBaseline() {
    return this.baseline;
  }

  getHistory() {
    return this.history;
  }

  /**
   * Feeds a new (known-target) error measurement into the detector and
   * returns whether drift is currently flagged.
   */
  addMeasurement(measurement: DriftMeasurement): DriftResult {
    this.history.push(measurement);
    if (this.history.length > ADAPTIVE_CONFIG.DRIFT_WINDOW) this.history.shift();

    if (!this.baseline) {
      // No baseline yet (calibration validation hasn't run) - can't judge drift.
      return { drifted: false, reason: null, baselineError: null, recentError: measurement.error };
    }

    const recent = this.history.slice(-ADAPTIVE_CONFIG.DRIFT_CONSECUTIVE_MEASUREMENTS);
    const ratioExceeded =
      recent.length >= ADAPTIVE_CONFIG.DRIFT_CONSECUTIVE_MEASUREMENTS &&
      recent.every((m) => m.error > this.baseline!.error * ADAPTIVE_CONFIG.DRIFT_ERROR_RATIO);

    if (ratioExceeded) {
      return { drifted: true, reason: 'error_ratio', baselineError: this.baseline.error, recentError: measurement.error };
    }

    // Systematic offset check: average dx/dy over the recent window vs baseline
    if (this.history.length >= ADAPTIVE_CONFIG.DRIFT_CONSECUTIVE_MEASUREMENTS) {
      const window = this.history.slice(-ADAPTIVE_CONFIG.DRIFT_WINDOW);
      const meanDx = window.reduce((s, m) => s + m.dx, 0) / window.length;
      const meanDy = window.reduce((s, m) => s + m.dy, 0) / window.length;
      const shiftFromBaseline = Math.hypot(meanDx - this.baseline.dx, meanDy - this.baseline.dy);
      if (shiftFromBaseline > ADAPTIVE_CONFIG.DRIFT_SYSTEMATIC_OFFSET_PX) {
        return { drifted: true, reason: 'systematic_offset', baselineError: this.baseline.error, recentError: measurement.error };
      }
    }

    return { drifted: false, reason: null, baselineError: this.baseline.error, recentError: measurement.error };
  }
}

// ============================================================================
// ADAPTIVE ENGINE STATUS (drives the "Adaptive Engine" dashboard panel)
// ============================================================================
export type AdaptiveStatus =
  | 'initial_calibration'
  | 'validating'
  | 'monitoring'
  | 'drift_detected'
  | 'collecting_samples'
  | 'updating_model'
  | 'adaptation_complete'
  | 'insufficient_data';

export const ADAPTIVE_STATUS_LABELS: Record<AdaptiveStatus, string> = {
  initial_calibration: 'Initial calibration',
  validating: 'Validating',
  monitoring: 'Monitoring',
  drift_detected: 'Drift detected',
  collecting_samples: 'Collecting samples',
  updating_model: 'Updating model',
  adaptation_complete: 'Adaptation complete',
  insufficient_data: 'Insufficient data',
};

// ============================================================================
// EXPERIMENT LOG / EXPORT
// ============================================================================
export interface ExperimentLogEntry {
  timestamp: number;
  phase: 'calibration' | 'recalibration' | 'validation' | 'monitoring' | 'micro_calibration_before' | 'micro_calibration_after';
  lightingCondition: LightingCondition;
  brightness: number | null;
  trackingQuality: number | null;
  gazeX: number | null;
  gazeY: number | null;
  targetX: number | null;
  targetY: number | null;
  errorPx: number | null;
  accepted: boolean;
  rejectionReason: RejectionReason;
  adaptationEvent: boolean;
  beforeErrorPx: number | null;
  afterErrorPx: number | null;
  adaptiveStatus: AdaptiveStatus | null;
}

const CSV_COLUMNS: Array<keyof ExperimentLogEntry> = [
  'timestamp', 'phase', 'lightingCondition', 'brightness', 'trackingQuality',
  'gazeX', 'gazeY', 'targetX', 'targetY', 'errorPx', 'accepted', 'rejectionReason',
  'adaptationEvent', 'beforeErrorPx', 'afterErrorPx', 'adaptiveStatus',
];

export function exportLogAsCSV(log: ExperimentLogEntry[]): string {
  const header = CSV_COLUMNS.join(',');
  const rows = log.map((entry) =>
    CSV_COLUMNS.map((col) => {
      const v = entry[col];
      if (v === null || v === undefined) return '';
      if (typeof v === 'string' && v.includes(',')) return `"${v}"`;
      return String(v);
    }).join(',')
  );
  return [header, ...rows].join('\n');
}

export function exportLogAsJSON(log: ExperimentLogEntry[], meta: Record<string, unknown> = {}): string {
  return JSON.stringify({ exportedAt: new Date().toISOString(), meta, entries: log }, null, 2);
}

// ============================================================================
// small helpers
// ============================================================================
function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}
function clamp01(v: number) {
  return clamp(v, 0, 1);
}
