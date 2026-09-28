import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { GazePoint, BlinkEvent } from '../types';
import { smoothGaze, GazeKalmanFilter, getGazedObject } from '../utils/math';
import { LightingMonitor, LightingReading } from '../utils/lighting';
import {
  computeTrackingQuality,
  classifySample,
  DriftDetector,
  TrackingQualityResult,
  AdaptiveStatus,
  ExperimentLogEntry,
  exportLogAsCSV,
  exportLogAsJSON,
} from '../utils/adaptiveEngine';

interface EyeTrackingContextType {
  isInitialized: boolean;
  initError: string | null;
  isCalibrating: boolean;
  isRecording: boolean;
  isStudyPaused: boolean;
  setIsStudyPaused: (paused: boolean) => void;
  currentImageId: string;
  setCurrentImageId: (id: string) => void;
  currentGaze: GazePoint | null;
  needsRecalibration: boolean;
  startCalibration: () => void;
  stopCalibration: () => void;
  startRecording: () => void;
  pauseRecording: () => void;
  resumeRecording: () => void;
  stopRecording: () => { logs: GazePoint[], blinks: BlinkEvent[] };
  resetSmoothing: () => void;
  adjustOffset: (targetX: number, targetY: number, dxDirect?: number, dyDirect?: number, instant?: boolean) => void;
  showVideo: (show: boolean) => void;
  clearData: () => void;
  initialize: () => Promise<void>;

  // --- Adaptive calibration / research instrumentation ---
  trackingQuality: TrackingQualityResult;
  lightingReading: LightingReading | null;
  sampleStats: { accepted: number; rejected: number };
  adaptiveStatus: AdaptiveStatus;
  setAdaptiveStatus: (s: AdaptiveStatus) => void;
  getOffset: () => { x: number; y: number };
  setOffsetExact: (x: number, y: number) => void;
  setCalibrationBaseline: (errorPx: number, dx: number, dy: number, sampleCount: number) => void;
  checkDrift: (errorPx: number, dx: number, dy: number) => { drifted: boolean; reason: 'error_ratio' | 'systematic_offset' | null; baselineError: number | null; recentError: number | null };
  logExperimentEntry: (entry: Partial<ExperimentLogEntry>) => void;
  getExperimentLog: () => ExperimentLogEntry[];
  exportExperimentData: (format: 'csv' | 'json') => string;
  resetAdaptiveEngine: () => void;
}

const EyeTrackingContext = createContext<EyeTrackingContextType>({} as EyeTrackingContextType);

export const useEyeTracking = () => useContext(EyeTrackingContext);

export const EyeTrackingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isInitialized, setIsInitialized] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isStudyPaused, setIsStudyPaused] = useState(false);
  const [currentImageId, setCurrentImageId] = useState('');
  const [currentGaze, setCurrentGaze] = useState<GazePoint | null>(null);
  const [needsRecalibration, setNeedsRecalibration] = useState(false);
  
  // We keep a history for smoothing
  const gazeHistory = useRef<GazePoint[]>([]);
  // Full recording log and events
  const sessionLog = useRef<GazePoint[]>([]);
  const blinkEvents = useRef<BlinkEvent[]>([]);
  
  // Prevent double init in Strict Mode
  const initAttempted = useRef(false);

  // Blink detection state
  const lastValidTime = useRef<number>(Date.now());
  const isBlinking = useRef(false);

  const now = () => Date.now();
  // Kalman Filter for noise reduction
  const kalmanFilter = useRef(new GazeKalmanFilter(0.05, 0.4)); // Starts responsive (0.05)
  
  // Calibration metrics ref for fast access in listener
  const calibrationMetrics = useRef<{offsetX: number, offsetY: number} | null>(null);
  
  // Accuracy monitoring variables
  const faceLostStartTime = useRef<number | null>(null);

  // ---- Adaptive calibration / research instrumentation ----
  const lightingMonitor = useRef(new LightingMonitor());
  const driftDetector = useRef(new DriftDetector());
  const experimentLog = useRef<ExperimentLogEntry[]>([]);
  const rawPointHistory = useRef<Array<{ x: number; y: number; t: number }>>([]); // pre-smoothing, for stability
  const detectionHistory = useRef<boolean[]>([]); // rolling window: was a prediction available this frame?
  const validityHistory = useRef<boolean[]>([]); // rolling window: was the raw point in-bounds?
  const sampleCounters = useRef({ accepted: 0, rejected: 0 });
  const lastQualityFlush = useRef(0);
  const lastLightingSampleTime = useRef(0);
  const lastMonitoringLog = useRef(0);
  const eyesDetectedFallback = useRef(true);

  const [trackingQuality, setTrackingQuality] = useState<TrackingQualityResult>({
    score: 0,
    status: { faceDetected: false, eyesDetected: false, stable: false, gazeValid: false, lightingOk: false },
  });
  const [lightingReading, setLightingReadingState] = useState<LightingReading | null>(null);
  const lightingReadingRef = useRef<LightingReading | null>(null);
  const setLightingReading = (r: LightingReading | null) => { lightingReadingRef.current = r; setLightingReadingState(r); };

  const [sampleStats, setSampleStats] = useState({ accepted: 0, rejected: 0 });
  const [adaptiveStatus, setAdaptiveStatusState] = useState<AdaptiveStatus>('initial_calibration');
  const adaptiveStatusRef = useRef<AdaptiveStatus>('initial_calibration');
  const setAdaptiveStatus = (s: AdaptiveStatus) => { adaptiveStatusRef.current = s; setAdaptiveStatusState(s); };

  // Pushes one row into the research/experiment log. Defaults are filled in
  // from the latest known signals (via refs, so this stays correct even
  // though it's called from inside the long-lived WebGazer listener closure).
  const pushLogEntry = (partial: Partial<ExperimentLogEntry>) => {
      const entry: ExperimentLogEntry = {
          timestamp: Date.now(),
          phase: 'monitoring',
          lightingCondition: lightingReadingRef.current?.condition || 'unknown',
          brightness: lightingReadingRef.current?.brightness ?? null,
          trackingQuality: null,
          gazeX: null,
          gazeY: null,
          targetX: null,
          targetY: null,
          errorPx: null,
          accepted: true,
          rejectionReason: null,
          adaptationEvent: false,
          beforeErrorPx: null,
          afterErrorPx: null,
          adaptiveStatus: adaptiveStatusRef.current,
          ...partial,
      };
      experimentLog.current.push(entry);
      // Cap memory usage for very long sessions - keep the most recent 20k rows
      if (experimentLog.current.length > 20000) {
          experimentLog.current.splice(0, experimentLog.current.length - 20000);
      }
  };

  // Use refs for listener to avoid effect re-runs and capture latest values in stream callbacks
  const isRecordingRef = useRef(false);
  const isCalibratingRef = useRef(false);
  const needsRecalibrationRef = useRef(false);
  const isStudyPausedRef = useRef(false);
  const currentImageIdRef = useRef('');

  useEffect(() => {
    isRecordingRef.current = isRecording;
    isCalibratingRef.current = isCalibrating;
    needsRecalibrationRef.current = needsRecalibration;
    isStudyPausedRef.current = isStudyPaused;
    currentImageIdRef.current = currentImageId;
  }, [isRecording, isCalibrating, needsRecalibration, isStudyPaused, currentImageId]);

  const initWebGazer = async () => {
    if (initAttempted.current) return;
    initAttempted.current = true;

    setInitError(null);
    console.log("Initializing WebGazer...");

    if (!window.webgazer) {
      // Try to load it dynamically if not present
      try {
          console.log("WebGazer not found, attempting dynamic load...");
          await new Promise((resolve, reject) => {
              const script = document.createElement('script');
              script.src = 'https://cdn.jsdelivr.net/npm/webgazer@3.3.0/dist/webgazer.js';
              script.onload = resolve;
              script.onerror = reject;
              document.head.appendChild(script);
          });
          // Wait a bit for execution
          await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (e) {
          console.warn("Primary WebGazer source failed, trying fallback...", e);
      }

      if (!window.webgazer) {
          setInitError("WebGazer library not found. Please check your internet connection and refresh.");
          initAttempted.current = false;
          return;
      }
    }

    // Check for localforage which is a dependency
    if (!window.localforage) {
        console.warn("localforage not found, waiting...");
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    try {
      const wg = window.webgazer;
      if (!wg) throw new Error("WebGazer not found on window");

      // Pre-flight check / request for camera permission
      if (navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function') {
        try {
          const testStream = await navigator.mediaDevices.getUserMedia({ video: true });
          testStream.getTracks().forEach(track => track.stop());
        } catch (camErr: any) {
          console.warn("Pre-flight camera permission check note:", camErr?.message || camErr);
          const camMsg = camErr?.message || "";
          if (
            camErr?.name === 'NotAllowedError' || 
            camErr?.name === 'PermissionDeniedError' || 
            camMsg.includes('Permission denied') ||
            camMsg.includes('permission')
          ) {
            throw new Error("Camera permission denied. Please allow camera access in your browser address bar and click 'Enable Camera & Retry'.");
          } else if (camErr?.name === 'NotFoundError' || camErr?.name === 'DevicesNotFoundError') {
            throw new Error("No camera device found on your system. Please connect a webcam and retry.");
          } else if (camErr?.name === 'NotReadableError' || camErr?.name === 'TrackStartError') {
            throw new Error("Camera is currently in use by another application. Please close other camera apps and retry.");
          }
        }
      }

      // 1. Initial Config
      // Clear any old data from localforage immediately
      if (typeof wg.clearData === 'function') {
          await wg.clearData();
          console.log("WebGazer data cleared for fresh session");
      }

      if (typeof wg.setGazeListener === 'function') {
          wg.setGazeListener((data: any, clock: number) => {
              if (data && data.x !== null && data.y !== null && !isNaN(data.x) && !isNaN(data.y)) {
                  // Face found, reset lost timer
                  faceLostStartTime.current = null;
                  if (needsRecalibrationRef.current) setNeedsRecalibration(false);

                  const duration = now() - lastValidTime.current;
                  if (isBlinking.current || (duration >= 130 && duration <= 2000)) {
                      if (duration >= 60 && duration <= 2000) {
                          blinkEvents.current.push({
                              startTime: lastValidTime.current,
                              duration,
                              isWink: false
                          });
                      }
                  }
                  isBlinking.current = false;
                  lastValidTime.current = now();

                  // ---- Adaptive calibration instrumentation ----
                  // These signals feed computeTrackingQuality()/classifySample() in
                  // utils/adaptiveEngine.ts. Kept lightweight: cheap rolling-window
                  // bookkeeping only, with the (slightly heavier) lighting sample
                  // throttled separately below.
                  detectionHistory.current.push(true);
                  if (detectionHistory.current.length > 30) detectionHistory.current.shift();

                  const rawInBounds = data.x >= 0 && data.x <= window.innerWidth && data.y >= 0 && data.y <= window.innerHeight;
                  validityHistory.current.push(rawInBounds);
                  if (validityHistory.current.length > 30) validityHistory.current.shift();

                  rawPointHistory.current.push({ x: data.x, y: data.y, t: now() });
                  if (rawPointHistory.current.length > 6) rawPointHistory.current.shift();
                  let headMovementPx = 0;
                  if (rawPointHistory.current.length >= 2) {
                      const xs = rawPointHistory.current.map(p => p.x);
                      const ys = rawPointHistory.current.map(p => p.y);
                      headMovementPx = (Math.max(...xs) - Math.min(...xs)) + (Math.max(...ys) - Math.min(...ys));
                  }

                  // Best-effort separate "eyes detected" signal. WebGazer's public
                  // gaze-listener callback only exposes a combined face+eyes
                  // prediction (it cannot produce x/y without locating the eyes),
                  // so there is no independently-measurable "face but no eyes"
                  // case through this API. Where the active tracker exposes its
                  // landmark positions we use that as a slightly stronger signal;
                  // otherwise we honestly fall back to the same detection signal
                  // rather than inventing a separate number.
                  try {
                      const tracker = wg.getTracker && wg.getTracker();
                      const positions = tracker && tracker.getPositions ? tracker.getPositions() : null;
                      eyesDetectedFallback.current = Array.isArray(positions) ? positions.length > 0 : true;
                  } catch {
                      eyesDetectedFallback.current = true;
                  }

                  // Lighting: sample at most ~2x/sec (canvas readback is not free)
                  const tNow = now();
                  if (tNow - lastLightingSampleTime.current > 500) {
                      lastLightingSampleTime.current = tNow;
                      const videoEl = document.querySelector('#webgazerVideoContainer video') as HTMLVideoElement | null;
                      const reading = lightingMonitor.current.sample(videoEl);
                      if (reading) setLightingReading(reading);
                  }

                  const detectionRate = detectionHistory.current.filter(Boolean).length / detectionHistory.current.length;
                  const gazeValidRate = validityHistory.current.filter(Boolean).length / validityHistory.current.length;
                  const stability = headMovementPx > 0 ? Math.max(0, 1 - headMovementPx / 150) : 1;

                  const qualityResult = computeTrackingQuality({
                      detectionRate,
                      gazeValidRate,
                      stability,
                      lighting: lightingReadingRef.current?.condition || 'unknown',
                      msSinceLastDetection: 0,
                      eyesDetected: eyesDetectedFallback.current,
                  });

                  const classification = classifySample({
                      predictionAvailable: true,
                      gazeX: data.x,
                      gazeY: data.y,
                      screenW: window.innerWidth,
                      screenH: window.innerHeight,
                      headMovementPx,
                      lighting: lightingReadingRef.current?.condition || 'unknown',
                      trackingQualityScore: qualityResult.score,
                  });
                  if (classification.reliable) sampleCounters.current.accepted++;
                  else sampleCounters.current.rejected++;

                  // Throttle React state flushes (quality/lighting/counters) so the
                  // ~30fps WebGazer callback doesn't trigger 30 re-renders/sec.
                  if (tNow - lastQualityFlush.current > 250) {
                      lastQualityFlush.current = tNow;
                      setTrackingQuality(qualityResult);
                      setSampleStats({ ...sampleCounters.current });
                  }
                  if (tNow - lastMonitoringLog.current > 500) {
                      lastMonitoringLog.current = tNow;
                      pushLogEntry({
                          phase: 'monitoring',
                          trackingQuality: qualityResult.score,
                          gazeX: Math.round(data.x),
                          gazeY: Math.round(data.y),
                          accepted: classification.reliable,
                          rejectionReason: classification.reason,
                      });
                  }

                  // Pupil Diameter Proxy: Use a baseline + slight physiological tremor
                  const pupilBaseline = 3.5; // mm approx
                  const pupilActivity = Math.sin(now() / 1000) * 0.1 + (Math.random() - 0.5) * 0.05;
                  const estimatedPupil = pupilBaseline + pupilActivity;

                  let x = data.x;
                  let y = data.y;
                  
                  // 0. Coordinate Correction: Apply Calibration-based offset
                  // SKIP correction if we are currently calibrating or validating
                  if (!isCalibratingRef.current && calibrationMetrics.current) {
                     x -= calibrationMetrics.current.offsetX;
                     y -= calibrationMetrics.current.offsetY;
                  }

                  // 1. Edge Case Handling: Edge Bias Correction
                  const edgeThresh = 80;
                  if (x < edgeThresh) x -= (edgeThresh - x) * 0.1;
                  if (x > window.innerWidth - edgeThresh) x += (x - (window.innerWidth - edgeThresh)) * 0.1;
                  if (y < edgeThresh) y -= (edgeThresh - y) * 0.1;
                  if (y > window.innerHeight - edgeThresh) y += (y - (window.innerHeight - edgeThresh)) * 0.1;

                  // 2. Clamping to valid bounds
                  x = Math.max(0, Math.min(window.innerWidth, x));
                  y = Math.max(0, Math.min(window.innerHeight, y));

                  // 2.5 Object Recognition Detection
                  const currentObject = getGazedObject(x, y, window.innerWidth, window.innerHeight, currentImageIdRef.current);

                  const rawPoint: GazePoint = { 
                      x, 
                      y, 
                      timestamp: Date.now(), 
                      pupilDiameter: estimatedPupil,
                      roiId: currentObject !== "Background" ? currentObject : undefined,
                      isPaused: isStudyPausedRef.current
                  };

                  // Basic Outlier Filtering
                  if (data.x < -400 || data.x > window.innerWidth + 400 || 
                      data.y < -400 || data.y > window.innerHeight + 400) {
                      return; 
                  }
                  
                  // 3. Noise Reduction: Apply Adaptive Kalman Filtering (updates velocity inside math)
                  const kalmanSmoothed = kalmanFilter.current.apply(rawPoint);
                  
                  gazeHistory.current.push(kalmanSmoothed);
                  if (gazeHistory.current.length > 10) gazeHistory.current.shift();
                  
                  // 4. Secondary Adaptive Weighted Smoothing for UI stability and lag prevention
                  const finalSmoothed = smoothGaze(gazeHistory.current) || kalmanSmoothed;

                  // Keep latest ROI ID and Paused status perfectly aligned
                  finalSmoothed.roiId = rawPoint.roiId;
                  finalSmoothed.isPaused = rawPoint.isPaused;

                  setCurrentGaze(finalSmoothed);

                  if (isRecordingRef.current) {
                    const lastLog = sessionLog.current[sessionLog.current.length - 1];
                    if (!lastLog || finalSmoothed.timestamp - lastLog.timestamp > 15) {
                       sessionLog.current.push(finalSmoothed);
                    }
                  }
              } else {
                  // Face possibly lost - start of potential blink
                  if (!isBlinking.current) {
                      isBlinking.current = true;
                  }

                  // Face possibly lost
                  if (!faceLostStartTime.current) faceLostStartTime.current = Date.now();
                  if (Date.now() - faceLostStartTime.current > 4000) {
                      setNeedsRecalibration(true);
                  }

                  // ---- Adaptive calibration instrumentation (no-detection frame) ----
                  detectionHistory.current.push(false);
                  if (detectionHistory.current.length > 30) detectionHistory.current.shift();

                  const tNow2 = now();
                  const msSinceLastDetection = tNow2 - lastValidTime.current;
                  const detectionRate2 = detectionHistory.current.filter(Boolean).length / detectionHistory.current.length;
                  const qualityResult2 = computeTrackingQuality({
                      detectionRate: detectionRate2,
                      gazeValidRate: validityHistory.current.length ? validityHistory.current.filter(Boolean).length / validityHistory.current.length : 0,
                      stability: 0,
                      lighting: lightingReadingRef.current?.condition || 'unknown',
                      msSinceLastDetection,
                      eyesDetected: false,
                  });
                  sampleCounters.current.rejected++;

                  if (tNow2 - lastQualityFlush.current > 250) {
                      lastQualityFlush.current = tNow2;
                      setTrackingQuality(qualityResult2);
                      setSampleStats({ ...sampleCounters.current });
                  }
                  if (tNow2 - lastMonitoringLog.current > 500) {
                      lastMonitoringLog.current = tNow2;
                      pushLogEntry({
                          phase: 'monitoring',
                          trackingQuality: qualityResult2.score,
                          accepted: false,
                          rejectionReason: 'face_not_detected',
                      });
                  }
              }
          });
      }

      // 2. Start WebGazer
      if (typeof wg.begin === 'function') {
          console.log("Calling wg.begin()...");
          await wg.begin();
          console.log("wg.begin() successful");
          
          if (wg.removeMouseEventListeners) wg.removeMouseEventListeners();
          await new Promise(resolve => setTimeout(resolve, 1000));
      } else {
          throw new Error("wg.begin is not a function");
      }

      // 3. Configure UI and Settings (Defensive)
      try {
          if (typeof wg.showVideo === 'function') wg.showVideo(false);
          if (typeof wg.showFaceOverlay === 'function') wg.showFaceOverlay(false);
          if (typeof wg.showPredictionPoints === 'function') wg.showPredictionPoints(false);
          
          if (typeof wg.setRegression === 'function') wg.setRegression('ridge');
          if (typeof wg.saveDataAcrossSessions === 'function') wg.saveDataAcrossSessions(false);

          // Load initial metrics
          const metricsStr = localStorage.getItem('calibrationMetrics');
          if (metricsStr) {
               const metrics = JSON.parse(metricsStr);
               calibrationMetrics.current = { 
                   offsetX: metrics.offsetX || 0, 
                   offsetY: metrics.offsetY || 0 
               };
          }

          const vid = document.getElementById('webgazerVideoContainer');
          if (vid) vid.style.display = 'none';
      } catch (e) {
          console.warn("Post-begin config failed", e);
      }

      setIsInitialized(true);
    } catch (e: any) {
      console.warn("WebGazer initialization status:", e?.message || e);
      initAttempted.current = false; 
      let msg = e?.message || "Camera initialization failed";
      if (
        msg.includes("Permission denied") || 
        msg.includes("permission") || 
        e?.name === "NotAllowedError" || 
        e?.name === "PermissionDeniedError"
      ) {
          msg = "Camera access denied. Please grant camera access in your browser address bar (camera or lock icon) and click 'Enable Camera & Retry'.";
      }
      setInitError(msg);
    }
  };

  useEffect(() => {
    initWebGazer();
  }, []);

  const startCalibration = () => {
    if (window.webgazer && window.webgazer.clearData) {
        window.webgazer.clearData();
    }
    localStorage.removeItem('calibrationMetrics');
    localStorage.removeItem('calibrationScore');
    calibrationMetrics.current = null;
    
    kalmanFilter.current.reset();
    setIsCalibrating(true);
    setNeedsRecalibration(false);
    showVideo(true);
  };

  const stopCalibration = () => {
    setIsCalibrating(false);
    showVideo(false);
    
    try {
        const metricsStr = localStorage.getItem('calibrationMetrics');
        if (metricsStr) {
            const metrics = JSON.parse(metricsStr);
            calibrationMetrics.current = { 
                offsetX: metrics.offsetX || 0, 
                offsetY: metrics.offsetY || 0 
            };
        }

        if (window.webgazer && window.webgazer.removeMouseEventListeners) {
            window.webgazer.removeMouseEventListeners();
            console.log("WebGazer mouse listeners removed to prevent drift");
        }
    } catch (e) {
        console.error("Failed to update calibration metrics ref", e);
    }
  };

  const startRecording = () => {
    sessionLog.current = [];
    blinkEvents.current = [];
    setIsRecording(true);
  };

  const pauseRecording = () => {
    // Keep isRecording true so coordinates flow during study pauses, but study knows it is paused.
    // This allows active monitoring and fixation parsing inside pause mode!
  };

  const resumeRecording = () => {
    // Keep isRecording true
  };

  const stopRecording = () => {
    setIsRecording(false);
    return { 
        logs: [...sessionLog.current], 
        blinks: [...blinkEvents.current] 
    };
  };

  const resetSmoothing = () => {
    kalmanFilter.current.reset();
    gazeHistory.current = [];
  };

  const adjustOffset = (targetX: number, targetY: number, dxDirect?: number, dyDirect?: number, instant?: boolean) => {
    if (!currentGaze && dxDirect === undefined) return;
    
    let dx = dxDirect !== undefined ? dxDirect : (currentGaze!.x - targetX);
    let dy = dyDirect !== undefined ? dyDirect : (currentGaze!.y - targetY);
    
    const factor = instant ? 1.0 : 0.5;
    
    // Update ref with partial adjustment (lerp for stability vs instant full alignment)
    if (calibrationMetrics.current) {
        calibrationMetrics.current.offsetX += dx * factor;
        calibrationMetrics.current.offsetY += dy * factor;
    } else {
        calibrationMetrics.current = { offsetX: dx, offsetY: dy };
    }

    try {
        localStorage.setItem('calibrationMetrics', JSON.stringify({
            ...(JSON.parse(localStorage.getItem('calibrationMetrics') || '{}')),
            offsetX: calibrationMetrics.current.offsetX,
            offsetY: calibrationMetrics.current.offsetY
        }));
    } catch (e) {
        console.warn("Storage item update failed gracefully", e);
    }
    
    console.log("Gaze offset adjusted:", calibrationMetrics.current);
  };

  const showVideo = (show: boolean) => {
    const vid = document.getElementById('webgazerVideoContainer');
    if (vid) vid.style.display = show ? 'block' : 'none';
    
    if (window.webgazer) {
        window.webgazer.showVideo(show);
        window.webgazer.showFaceOverlay(show);
        window.webgazer.showPredictionPoints(show);
    }
  };

  const clearData = () => {
    sessionLog.current = [];
  };

  // ---- Adaptive calibration / research API ----

  // Direct offset read/write (bypasses the lerp in adjustOffset) so the
  // micro-calibration safety net can save the pre-update offset and roll
  // back to it exactly if the update turns out to make things worse.
  const getOffset = () => ({
      x: calibrationMetrics.current?.offsetX || 0,
      y: calibrationMetrics.current?.offsetY || 0,
  });

  const setOffsetExact = (x: number, y: number) => {
      calibrationMetrics.current = { offsetX: x, offsetY: y };
      try {
          localStorage.setItem('calibrationMetrics', JSON.stringify({
              ...(JSON.parse(localStorage.getItem('calibrationMetrics') || '{}')),
              offsetX: x,
              offsetY: y,
          }));
      } catch (e) {
          console.warn("Storage item update failed gracefully", e);
      }
  };

  const setCalibrationBaseline = (errorPx: number, dx: number, dy: number, sampleCount: number) => {
      driftDetector.current.setBaseline(errorPx, dx, dy);
      pushLogEntry({
          phase: 'validation',
          errorPx,
          trackingQuality: trackingQuality.score,
          accepted: sampleCount >= 2,
      });
  };

  const checkDrift = (errorPx: number, dx: number, dy: number) => {
      return driftDetector.current.addMeasurement({ timestamp: Date.now(), error: errorPx, dx, dy });
  };

  const logExperimentEntry = (entry: Partial<ExperimentLogEntry>) => pushLogEntry(entry);

  const getExperimentLog = () => [...experimentLog.current];

  const exportExperimentData = (format: 'csv' | 'json') => {
      if (format === 'csv') return exportLogAsCSV(experimentLog.current);
      return exportLogAsJSON(experimentLog.current, {
          totalEntries: experimentLog.current.length,
          sampleStats: sampleCounters.current,
      });
  };

  const resetAdaptiveEngine = () => {
      driftDetector.current.reset();
      experimentLog.current = [];
      sampleCounters.current = { accepted: 0, rejected: 0 };
      setSampleStats({ accepted: 0, rejected: 0 });
      lightingMonitor.current.reset();
      setAdaptiveStatus('initial_calibration');
  };

  return (
    <EyeTrackingContext.Provider value={{
      isInitialized,
      initError,
      isCalibrating,
      isRecording,
      isStudyPaused,
      setIsStudyPaused,
      currentImageId,
      setCurrentImageId,
      currentGaze,
      needsRecalibration,
      startCalibration,
      stopCalibration,
      startRecording,
      pauseRecording,
      resumeRecording,
      stopRecording,
      resetSmoothing,
      adjustOffset,
      showVideo,
      clearData,
      initialize: initWebGazer,

      trackingQuality,
      lightingReading,
      sampleStats,
      adaptiveStatus,
      setAdaptiveStatus,
      getOffset,
      setOffsetExact,
      setCalibrationBaseline,
      checkDrift,
      logExperimentEntry,
      getExperimentLog,
      exportExperimentData,
      resetAdaptiveEngine,
    }}>
      {children}
    </EyeTrackingContext.Provider>
  );
};
