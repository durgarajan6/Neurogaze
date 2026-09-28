export interface GazePoint {
  x: number;
  y: number;
  timestamp: number;
  roiId?: string;
  pupilDiameter?: number; // Estimated
  isPaused?: boolean;
}

export interface BlinkEvent {
  startTime: number;
  duration: number;
  isWink: boolean;
}

export interface CalibrationPoint {
  id: number;
  x: string; // Tailwind class or percent
  y: string;
  label: string;
}

export interface Fixation {
  x: number;
  y: number;
  duration: number; // ms
  startTime: number;
  roiId?: string;
  isPaused?: boolean;
}

export interface Saccade {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  startTime: number; // Added
  duration: number;
  velocity: number; // pixels/ms
  amplitude: number; // pixels
  latency?: number; // ms from stimulus
  isMicrosaccade?: boolean;
}

export interface AdvancedMetrics {
  // Oculomotor
  fixationCount: number;
  avgFixationDuration: number;
  totalDwellTime: number; // Added
  avgSaccadeVelocity: number;
  saccadeCount: number;
  saccadeAmplitude: number;
  smoothPursuitScore: number;
  microsaccadeCount: number;
  postSaccadicMovement: number; // Stability after saccade

  // Blink Analysis
  blinkRate: number; // blinks/min
  blinkInstability: number;
  winkCount: number;

  // Pupil Analysis
  avgPupilDiameter: number;
  pupilActivity: number; // Variance
  pupilResponseLatency: number;

  // Attention & Fatigue
  sustainedAttentionScore: number;
  fatigueScore: number; // 0-100
  focusStability: number;

  // Gaze Stability
  bcea: number;
  accuracy: number; // pixels error
  precision: number; // RMS jitter
  drift: number; // pixels/sec
  tremorFreq: number; // Hz

  // Neurological Indicators
  vorGain: number; // Vestibulo-Ocular Reflex proxy
  vergenceIndex: number;
  nystagmusIntensity: number;
  cytokineticIndex: number;
}

export interface ImageSessionData {
  imageId: string;
  imageUrl: string;
  startTime: number;
  endTime: number;
  screenDimensions: { width: number; height: number };
  gazeLogs: GazePoint[];
  fixations: Fixation[];
  saccades: Saccade[];
  blinks: BlinkEvent[];
  quality: DataQuality;
  metrics: AdvancedMetrics;
}

export interface DataQuality {
  accuracy: number;
  precision: number;
  dataLoss: number;
}

export interface StudySession {
  id: string;
  participantId?: string;
  age?: number;
  condition?: string;
  timestamp: Date;
  calibrationScore: number;
  results: ImageSessionData[];
}

export interface StudyImage {
  id: string;
  url: string;
  name: string;
  duration: number; // ms
}

// Declare WebGazer on window
declare global {
  interface Window {
    webgazer: any;
  }
}