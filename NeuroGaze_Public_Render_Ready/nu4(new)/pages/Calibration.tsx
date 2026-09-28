import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useEyeTracking } from '../context/EyeTrackingContext';
import { CalibrationPoint } from '../types';
import { CheckCircle, Target, RefreshCw, AlertCircle, Download, BarChart3 } from 'lucide-react';
import { CalibrationDashboard } from '../components/CalibrationDashboard';
import { CalibrationErrorGraph, ErrorGraphPoint } from '../components/CalibrationErrorGraph';

// Minimum tracking-quality score (0-100) below which a click sample is
// logged as "rejected" for research/dashboard purposes. This does NOT block
// the existing click-to-advance mechanic - it only affects what is counted
// as a reliable sample in the experiment log / sample-quality panel, so a
// poor reading never prevents someone from completing calibration.
const CALIBRATION_SAMPLE_MIN_QUALITY = 30;

const pctToPx = (pct: string, dimension: number) => (parseFloat(pct) / 100) * dimension;

  // Improved grid positions: Moved to 10%/90% to cover more screen area
  // This helps with "full screen" accuracy
  const CALIBRATION_POINTS: CalibrationPoint[] = [
    { id: 1, x: '10%', y: '10%', label: 'Top Left' },
    { id: 2, x: '50%', y: '10%', label: 'Top Center' },
    { id: 3, x: '90%', y: '10%', label: 'Top Right' },
    { id: 4, x: '10%', y: '50%', label: 'Middle Left' },
    { id: 5, x: '50%', y: '50%', label: 'Center' },
    { id: 6, x: '90%', y: '50%', label: 'Middle Right' },
    { id: 7, x: '10%', y: '90%', label: 'Bottom Left' },
    { id: 8, x: '50%', y: '90%', label: 'Bottom Center' },
    { id: 9, x: '90%', y: '90%', label: 'Bottom Right' },
  ];

  const CLICKS_TO_ADVANCE = 4;

  // Validation now checks 4 points instead of just the center dot: the
  // center plus 3 random points, generated fresh each run so attention is
  // actually being monitored (not memorized). Percent coordinates, kept
  // away from the very edge and spaced apart from each other.
  const VALIDATION_POINTS_COUNT = 4;
  const generateValidationPoints = (): { x: number; y: number; label: string }[] => {
    const points: { x: number; y: number; label: string }[] = [{ x: 50, y: 50, label: 'Center' }];
    const minSepPct = 22;
    let attempts = 0;
    while (points.length < VALIDATION_POINTS_COUNT && attempts < 200) {
      attempts++;
      const candidate = { x: 12 + Math.random() * 76, y: 12 + Math.random() * 76, label: `Point ${points.length + 1}` };
      const tooClose = points.some(p => Math.hypot(p.x - candidate.x, p.y - candidate.y) < minSepPct);
      if (!tooClose) points.push(candidate);
    }
    // Guarantee 4 points even if random placement kept colliding
    const fallbackSpots = [{ x: 20, y: 20 }, { x: 80, y: 25 }, { x: 25, y: 80 }, { x: 78, y: 78 }];
    let fi = 0;
    while (points.length < VALIDATION_POINTS_COUNT) {
      points.push({ ...fallbackSpots[fi % fallbackSpots.length], label: `Point ${points.length + 1}` });
      fi++;
    }
    return points;
  };

  // How many of the original 9 points get a second, targeted pass. These
  // are chosen after the first pass as the points with the highest measured
  // gaze-vs-target error, so the extra clicks go where they help accuracy
  // the most rather than repeating every point blindly.
  const RECALIBRATION_POINTS_COUNT = 4;

  const Calibration: React.FC = () => {
    const navigate = useNavigate();
    const {
      startCalibration, stopCalibration, currentGaze,
      trackingQuality, lightingReading, sampleStats, adaptiveStatus, setAdaptiveStatus,
      setCalibrationBaseline, logExperimentEntry, exportExperimentData, resetAdaptiveEngine,
    } = useEyeTracking();
    // 'initial' = the original 9-point pass. 'recalibrate' = the extra pass
    // over the worst-performing points identified during the initial pass.
    const [phase, setPhase] = useState<'initial' | 'recalibrate'>('initial');
    const [recalPoints, setRecalPoints] = useState<CalibrationPoint[]>([]);
    const activePoints = phase === 'initial' ? CALIBRATION_POINTS : recalPoints;

    const [currentPointIndex, setCurrentPointIndex] = useState(0);
    const [clicksPerPoint, setClicksPerPoint] = useState(0);
    const [isComplete, setIsComplete] = useState(false);
    const [isValidating, setIsValidating] = useState(false);
    const [accuracy, setAccuracy] = useState<number>(0);

    // Research/adaptive-calibration instrumentation (additive - does not
    // change the existing 9-point click flow or scoring formula below).
    const [graphPoints, setGraphPoints] = useState<ErrorGraphPoint[]>([]);
    const [validSamplePct, setValidSamplePct] = useState<number | null>(null);
    const [exportMsg, setExportMsg] = useState<string | null>(null);
    
    // State to control sample collection
    const [isCollectingSamples, setIsCollectingSamples] = useState(false);
    const validationSamples = useRef<Array<{dist: number, dx: number, dy: number, reliable: boolean}>>([]);

    // Multi-point validation: the 4 points being validated this run (center
    // + 3 random), which one is currently active, and the accumulated
    // per-point results used to compute the final aggregate score/offset.
    const [validationPoints, setValidationPoints] = useState<{ x: number; y: number; label: string }[]>([]);
    const [validationIndex, setValidationIndex] = useState(0);
    const perPointResults = useRef<Array<{ label: string; avgDist: number; dx: number; dy: number; score: number; samples: number; reliable: number }>>([]);
    // Pixel target of the point currently being validated - the sample
    // collector below measures gaze error against this, not a fixed center.
    const validationTargetRef = useRef({ x: 0, y: 0 });

    // Per-point error accumulator for the initial 9-point pass, keyed by
    // index into CALIBRATION_POINTS. Used to pick which 4 points need a
    // second, more accurate pass.
    const pointErrorStats = useRef<Record<number, { sum: number; count: number }>>({});
    
    // Ref to prevent double-triggers during transitions
    const isTransitioning = useRef(false);

    useEffect(() => {
      // Request full screen for better accuracy
      const enterFullScreen = async () => {
          try {
              if (!document.fullscreenElement) {
                  await document.documentElement.requestFullscreen();
              }
          } catch (e) {
              console.warn("Fullscreen denied", e);
          }
      };
      enterFullScreen();

      // Start fresh
      startCalibration();
      resetAdaptiveEngine();
      setAdaptiveStatus('initial_calibration');
      
      // Clean up when leaving
      return () => {
        stopCalibration();
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

  // Sample Collection Hook
  // Collects gaze data when the validation phase is active
  useEffect(() => {
    if (isCollectingSamples && currentGaze) {
       const { x: targetX, y: targetY } = validationTargetRef.current;
       const dx = currentGaze.x - targetX;
       const dy = currentGaze.y - targetY;
       const dist = Math.sqrt(Math.pow(dx, 2) + Math.pow(dy, 2));

       // A validation sample is "reliable" (for reporting purposes only -
       // it does not affect the score formula below) when tracking quality
       // was acceptable and lighting wasn't actively degrading detection.
       const reliable = trackingQuality.score >= CALIBRATION_SAMPLE_MIN_QUALITY &&
                         lightingReading?.condition !== 'unstable';

       // Record sample for validation
       validationSamples.current.push({ dist, dx, dy, reliable });
    }
  }, [currentGaze, isCollectingSamples, trackingQuality.score, lightingReading?.condition]);

  // Runs validation across all 4 points (center + 3 random) in sequence.
  // Each point is measured the same way the old center-only check was, but
  // the final score/offset are aggregated across all 4 - so a good center
  // reading can no longer hide a bad corner, and the offset correction that
  // gets applied everywhere (including during the slideshow) reflects the
  // whole screen instead of just the middle.
  const performValidation = async () => {
    const points = generateValidationPoints();
    setValidationPoints(points);
    perPointResults.current = [];
    setIsValidating(true);
    setAdaptiveStatus('validating');
    setClicksPerPoint(0);

    if (window.webgazer) {
       window.webgazer.showPredictionPoints(true);
       if (window.webgazer.resume) window.webgazer.resume();
    }

    for (let i = 0; i < points.length; i++) {
      setValidationIndex(i);
      const pt = points[i];
      const targetX = (pt.x / 100) * window.innerWidth;
      const targetY = (pt.y / 100) * window.innerHeight;
      validationTargetRef.current = { x: targetX, y: targetY };

      // 1. Wait for eyes to settle on the new dot before sampling
      await new Promise(resolve => setTimeout(resolve, 1000));

      // 2. Collect samples for this point (~1.8s each - 4 points now, so
      // shorter per-point than the old single 3s center check while still
      // covering the whole screen)
      validationSamples.current = [];
      setIsCollectingSamples(true);
      await new Promise(resolve => setTimeout(resolve, 1800));
      setIsCollectingSamples(false);

      const samples = validationSamples.current;
      let score = 0, avgDist = 0, meanDx = 0, meanDy = 0;

      if (samples.length >= 2) {
          let effectiveDist = 0;
          if (samples.length >= 5) {
              const distances = samples.map(s => s.dist).sort((a, b) => a - b);
              effectiveDist = distances[Math.floor(distances.length / 2)];
          } else {
              effectiveDist = samples.reduce((acc, s) => acc + s.dist, 0) / samples.length;
          }
          avgDist = effectiveDist;
          meanDx = samples.reduce((acc, s) => acc + s.dx, 0) / samples.length;
          meanDy = samples.reduce((acc, s) => acc + s.dy, 0) / samples.length;
          const rawScore = 100 - (effectiveDist / 16);
          score = Math.max(0, Math.min(100, rawScore));

          // Reinforce the regression model right at this measured point when
          // it missed by a meaningful margin - this is real calibration data
          // (we know exactly where the user was looking), not a guess, so it
          // genuinely tightens accuracy at that part of the screen.
          if (window.webgazer && avgDist > 20) {
              window.webgazer.recordScreenPosition(targetX, targetY, 'click');
          }
      } else {
          console.warn("Insufficient validation samples for", pt.label, samples.length);
      }

      const reliableCount = samples.filter(s => s.reliable).length;
      perPointResults.current.push({ label: pt.label, avgDist, dx: meanDx, dy: meanDy, score, samples: samples.length, reliable: reliableCount });
      setGraphPoints(prev => [...prev, { index: prev.length, error: avgDist, phase: 'validation' }]);
      logExperimentEntry({ phase: 'validation', errorPx: avgDist, targetX, targetY, trackingQuality: trackingQuality.score });
    }

    if (window.webgazer) window.webgazer.showPredictionPoints(false);

    // Aggregate the 4 points into one final score + one offset correction
    const results = perPointResults.current;
    const validResults = results.filter(r => r.samples >= 2);
    const overallScore = validResults.length > 0
      ? validResults.reduce((s, r) => s + r.score, 0) / validResults.length
      : 0;
    const avgOffsetDist = validResults.length > 0
      ? validResults.reduce((s, r) => s + r.avgDist, 0) / validResults.length
      : 0;
    const avgDx = validResults.length > 0 ? validResults.reduce((s, r) => s + r.dx, 0) / validResults.length : 0;
    const avgDy = validResults.length > 0 ? validResults.reduce((s, r) => s + r.dy, 0) / validResults.length : 0;
    const totalSamples = results.reduce((s, r) => s + r.samples, 0);
    const totalReliable = results.reduce((s, r) => s + r.reliable, 0);
    const pctReliable = totalSamples > 0 ? Math.round((totalReliable / totalSamples) * 100) : null;

    setAccuracy(Math.round(overallScore));
    setValidSamplePct(pctReliable);

    // Save detailed quality metrics for the Study/Results phase
    const qualityMetrics = {
        score: Math.round(overallScore),
        offset: Math.round(avgOffsetDist),
        offsetX: Math.round(avgDx),
        offsetY: Math.round(avgDy),
        timestamp: Date.now(),
        samples: totalSamples,
        reliableSamples: totalReliable,
        validSamplePct: pctReliable,
        perPoint: results,
    };
    localStorage.setItem('calibrationMetrics', JSON.stringify(qualityMetrics));

    // Baseline for drift detection + the offset correction that the
    // slideshow's red dot is actually drawn with, now averaged across the
    // whole screen instead of just the center.
    if (totalSamples >= 2) {
        setCalibrationBaseline(avgOffsetDist, avgDx, avgDy, totalSamples);
    }
    setAdaptiveStatus('monitoring');

    setIsValidating(false);
    setIsComplete(true);
  };

  // Watch for completion of a point (4 clicks)
  useEffect(() => {
    if (clicksPerPoint >= CLICKS_TO_ADVANCE && !isTransitioning.current) {
      isTransitioning.current = true;
      
      const timer = setTimeout(() => {
        if (currentPointIndex < activePoints.length - 1) {
          setCurrentPointIndex(prev => prev + 1);
          setClicksPerPoint(0);
          isTransitioning.current = false;
        } else if (phase === 'initial') {
          // Finished the original 9 points - now identify the 4 that had
          // the highest gaze-vs-target error and give them a targeted
          // second pass before validating overall accuracy.
          const worst = pickWorstPoints(RECALIBRATION_POINTS_COUNT);
          setRecalPoints(worst);
          setPhase('recalibrate');
          setCurrentPointIndex(0);
          setClicksPerPoint(0);
          isTransitioning.current = false;
        } else {
          // Finished the extra recalibration pass - start validation
          performValidation();
        }
      }, 300);
      
      return () => clearTimeout(timer);
    }
  }, [clicksPerPoint, currentPointIndex, phase, activePoints.length]);

  const handlePointClick = (e: React.MouseEvent) => {
    // Item #9 / #12: log the gaze-vs-target error at the instant of the
    // click, BEFORE this click's recordScreenPosition() call below updates
    // WebGazer's regression model. This is a genuine per-sample measurement
    // of how calibration error evolves as more points are added - not a
    // simulated or estimated value.
    if (currentGaze) {
        const targetX = e.clientX;
        const targetY = e.clientY;
        const preClickError = Math.hypot(currentGaze.x - targetX, currentGaze.y - targetY);
        const reliable = trackingQuality.score >= CALIBRATION_SAMPLE_MIN_QUALITY;

        setGraphPoints(prev => [...prev, { index: prev.length, error: preClickError, phase: phase === 'initial' ? 'initial' : 'recalibration' }]);
        logExperimentEntry({
            phase: phase === 'initial' ? 'calibration' : 'recalibration',
            gazeX: Math.round(currentGaze.x),
            gazeY: Math.round(currentGaze.y),
            targetX, targetY,
            errorPx: preClickError,
            trackingQuality: trackingQuality.score,
            accepted: reliable,
            rejectionReason: reliable ? null : (lightingReading?.condition === 'low' || lightingReading?.condition === 'unstable' ? 'poor_lighting' : 'low_confidence'),
        });

        // During the initial pass, accumulate per-point error so we can
        // identify the worst-performing points afterwards for a targeted
        // recalibration pass.
        if (phase === 'initial') {
            const stats = pointErrorStats.current[currentPointIndex] || { sum: 0, count: 0 };
            stats.sum += preClickError;
            stats.count += 1;
            pointErrorStats.current[currentPointIndex] = stats;
        }
    }

    // Explicitly record the calibration point in WebGazer to ensure accuracy
    if (window.webgazer) {
        window.webgazer.recordScreenPosition(e.clientX, e.clientY, 'click');
        
        // Task 1: Weighted Calibration (Center Priority)
        // If this is the center point, record it twice per click to give it
        // more weight in the regression model. Checked by label so it still
        // applies correctly regardless of which pass/array we're iterating.
        if (activePoints[currentPointIndex]?.label === 'Center') {
            window.webgazer.recordScreenPosition(e.clientX, e.clientY, 'click');
            console.log("Applied center priority weight");
        }

        // Recalibration pass: these points were the least accurate the
        // first time around, so weight them more heavily in the regression
        // model to actually move the needle on accuracy.
        if (phase === 'recalibrate') {
            window.webgazer.recordScreenPosition(e.clientX, e.clientY, 'click');
        }
    }
    
    // Use functional update to reliably increment
    setClicksPerPoint(prev => {
        if (prev >= CLICKS_TO_ADVANCE) return prev;
        return prev + 1;
    });
  };

  // Pick the N points from the initial pass with the highest average
  // gaze-vs-target error. Falls back to filling any remaining slots with
  // points that had no recorded samples, so we always return exactly N
  // points (as long as N <= CALIBRATION_POINTS.length).
  const pickWorstPoints = (n: number): CalibrationPoint[] => {
      const withData: Array<{ index: number; avgError: number }> = [];
      const withoutData: number[] = [];

      CALIBRATION_POINTS.forEach((_, index) => {
          const stats = pointErrorStats.current[index];
          if (stats && stats.count > 0) {
              withData.push({ index, avgError: stats.sum / stats.count });
          } else {
              withoutData.push(index);
          }
      });

      withData.sort((a, b) => b.avgError - a.avgError);

      const chosenIndices = [
          ...withData.slice(0, n).map(p => p.index),
          ...withoutData,
      ].slice(0, n);

      return chosenIndices.map(index => CALIBRATION_POINTS[index]);
  };

  const handleRetry = () => {
    setIsComplete(false);
    setAccuracy(0);
    setPhase('initial');
    setRecalPoints([]);
    pointErrorStats.current = {};
    setCurrentPointIndex(0);
    setClicksPerPoint(0);
    isTransitioning.current = false;
    validationSamples.current = [];
    setValidationPoints([]);
    setValidationIndex(0);
    perPointResults.current = [];
    setGraphPoints([]);
    setValidSamplePct(null);
    setExportMsg(null);
    resetAdaptiveEngine();
    setAdaptiveStatus('initial_calibration');
    // Re-trigger start to clear data
    startCalibration();
  };

  const handleExportResearchData = (format: 'csv' | 'json') => {
    const data = exportExperimentData(format);
    const mime = format === 'csv' ? 'text/csv' : 'application/json';
    const blob = new Blob([data], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `neurogaze_calibration_experiment_${Date.now()}.${format}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setExportMsg(`Exported ${format.toUpperCase()} log`);
    setTimeout(() => setExportMsg(null), 2500);
  };

  const handleFinish = () => {
    stopCalibration();
    if (window.webgazer) {
      window.webgazer.showPredictionPoints(false); 
      window.webgazer.showVideo(false);
    }
    
    // Save accuracy to localStorage for Results page
    localStorage.setItem('calibrationScore', accuracy.toString());
    
    navigate('/study');
  };

  if (isComplete) {
    return (
      <div className="min-h-screen flex flex-col md:flex-row items-start justify-center gap-6 bg-slate-900 text-white p-4 md:p-10 overflow-y-auto">
        <div className="bg-slate-800 p-8 rounded-2xl shadow-2xl text-center max-w-md w-full animate-fade-in border border-slate-700 mx-auto md:mx-0">
          {accuracy > 60 ? (
              <CheckCircle className="w-20 h-20 text-green-500 mx-auto mb-6" />
          ) : (
              <AlertCircle className="w-20 h-20 text-yellow-500 mx-auto mb-6" />
          )}
          
          <h2 className="text-3xl font-bold mb-4">Calibration Complete</h2>
          
          <div className={`bg-slate-700/50 rounded-xl p-4 mb-6 border ${accuracy > 60 ? 'border-green-500/30' : 'border-yellow-500/30'}`}>
             <p className="text-slate-400 text-sm uppercase tracking-wider font-bold mb-1">Calibration Score</p>
             <div className="flex items-center justify-center gap-2">
                 <span className={`text-5xl font-extrabold ${accuracy > 80 ? 'text-green-400' : accuracy > 60 ? 'text-yellow-400' : 'text-red-400'}`}>
                    {accuracy}%
                 </span>
             </div>
             <p className="text-xs text-slate-400 mt-3 px-2">
               {accuracy > 80 ? "Excellent. Tracking is precise." : accuracy > 60 ? "Good. Tracking is acceptable." : "Poor accuracy. See tips below."}
             </p>
          </div>

          {accuracy < 70 && (
            <div className="text-left mb-6 bg-slate-900/50 p-4 rounded-xl border border-slate-700">
               <h3 className="text-xs font-bold text-slate-400 uppercase mb-3 flex items-center">
                 <AlertCircle size={14} className="mr-2 text-yellow-500" /> Improvement Tips
               </h3>
               <ul className="text-[11px] text-slate-300 space-y-2 list-disc pl-4">
                 <li><strong>Don't "Chase" the Dot:</strong> Look at the circle first, then click. Clicking while your eyes are moving reduces accuracy.</li>
                 <li><strong>Click Speed:</strong> Moderate, consistent clicks are best. Very slow clicks can record involuntary eye drift.</li>
                 <li><strong>Lighting:</strong> Ensure your face is evenly lit. Shadows on your eyes can confuse the camera.</li>
                 <li><strong>Head Movement:</strong> Keep your head completely still once calibration starts.</li>
               </ul>
            </div>
          )}

          <div className="space-y-3">
            <button 
                onClick={handleFinish}
                disabled={accuracy < 40}
                className={`w-full font-bold py-3 px-6 rounded-lg transition-all shadow-lg ${accuracy < 40 ? 'bg-slate-600 cursor-not-allowed opacity-50' : 'bg-blue-600 hover:bg-blue-700 shadow-blue-600/30 text-white'}`}
            >
                {accuracy < 40 ? "Score too low" : "Begin Assessment"}
            </button>
            
            <button 
                onClick={handleRetry}
                className="w-full bg-slate-700 hover:bg-slate-600 text-slate-200 font-medium py-3 px-6 rounded-lg transition-colors flex items-center justify-center gap-2"
            >
                <RefreshCw size={18} /> Recalibrate
            </button>
          </div>
        </div>

        {/* Research / adaptive-calibration panel - additive, does not affect
            the score or the Begin Assessment / Recalibrate flow above. */}
        <div className="w-full max-w-md mx-auto md:mx-0 space-y-4">
          <CalibrationDashboard
            pointsDone={CALIBRATION_POINTS.length + RECALIBRATION_POINTS_COUNT}
            totalPoints={CALIBRATION_POINTS.length + RECALIBRATION_POINTS_COUNT}
            trackingQuality={trackingQuality}
            lightingReading={lightingReading}
            sampleStats={sampleStats}
            adaptiveStatus={adaptiveStatus}
            currentErrorPx={null}
            validationScore={accuracy}
          />

          <div className="bg-slate-800 border border-slate-700 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                <BarChart3 size={14} /> Calibration Error Over Samples
              </h3>
            </div>
            <CalibrationErrorGraph points={graphPoints} height={200} />
            {validSamplePct !== null && (
              <p className="text-[11px] text-slate-400 mt-2">
                Validation reliable-sample rate: <span className="font-mono text-slate-200">{validSamplePct}%</span>
              </p>
            )}
          </div>

          <div className="bg-slate-800 border border-slate-700 rounded-2xl p-4">
            <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-3">Research Mode - Export</h3>
            <div className="flex gap-2">
              <button onClick={() => handleExportResearchData('csv')} className="flex-1 bg-slate-700 hover:bg-slate-600 text-slate-100 text-xs font-medium py-2 px-3 rounded-lg flex items-center justify-center gap-1.5">
                <Download size={13} /> CSV
              </button>
              <button onClick={() => handleExportResearchData('json')} className="flex-1 bg-slate-700 hover:bg-slate-600 text-slate-100 text-xs font-medium py-2 px-3 rounded-lg flex items-center justify-center gap-1.5">
                <Download size={13} /> JSON
              </button>
            </div>
            {exportMsg && <p className="text-[11px] text-emerald-400 mt-2 text-center">{exportMsg}</p>}
            <p className="text-[10px] text-slate-500 mt-2 leading-relaxed">
              Exports every logged gaze sample this session (calibration clicks, validation, and any adaptive updates during the study) with lighting, tracking-quality and accept/reject reasons - for use in your project's results section.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-screen h-screen bg-slate-950 overflow-hidden cursor-crosshair">
      {/* Live research dashboard - compact, non-blocking, top-right corner */}
      <div className="absolute top-4 right-4 z-40 pointer-events-none opacity-95">
        <CalibrationDashboard
          pointsDone={
            (phase === 'recalibrate' ? CALIBRATION_POINTS.length : 0) +
            currentPointIndex + (clicksPerPoint >= CLICKS_TO_ADVANCE ? 1 : 0)
          }
          totalPoints={CALIBRATION_POINTS.length + RECALIBRATION_POINTS_COUNT}
          trackingQuality={trackingQuality}
          lightingReading={lightingReading}
          sampleStats={sampleStats}
          adaptiveStatus={adaptiveStatus}
          currentErrorPx={null}
          validationScore={null}
          compact
        />
      </div>

      {/* Instruction Overlay - Top Center */}
      <div className="absolute top-4 left-0 right-0 flex flex-col items-center pointer-events-none z-20">
        <div className="bg-slate-900/90 backdrop-blur text-white px-8 py-4 rounded-2xl text-center border border-slate-700 shadow-xl mb-4">
           {isValidating ? (
               <span className="flex flex-col items-center justify-center text-blue-300 text-lg gap-1">
                   <span className="flex items-center justify-center">
                       <Target className="w-5 h-5 mr-3 animate-spin-slow"/>
                       {validationPoints[validationIndex]?.label === 'Center'
                         ? 'Validating... Please look steadily at the Red Center Dot.'
                         : 'Validating attention... Please look steadily at the Red Dot.'}
                   </span>
                   <span className="text-slate-400 text-xs font-mono">
                       Point {validationIndex + 1} of {validationPoints.length || VALIDATION_POINTS_COUNT}
                   </span>
               </span>
           ) : (
               <div className="space-y-1">
                   {phase === 'recalibrate' && (
                       <div className="text-orange-400 text-xs font-bold uppercase tracking-wide mb-1">
                            Recalibration Pass
                       </div>
                   )}
                   <div className="text-lg font-semibold text-white">
                        Point {currentPointIndex + 1} of {activePoints.length}
                   </div>
                   <div className="text-slate-400 text-sm">
                        {phase === 'recalibrate'
                          ? 'This point needs extra accuracy - look at the circle and click it '
                          : 'Look at the circle and click it '}
                        {CLICKS_TO_ADVANCE} times.
                   </div>
                   <div className="text-yellow-400 text-xs font-bold uppercase tracking-wide mt-2 pt-2 border-t border-slate-700">
                        ⚠ Important: Keep your head still
                   </div>
               </div>
           )}
        </div>
      </div>

      {/* Validation Point - center + 3 random points, shown one at a time
          during validation so gaze accuracy (and attention) gets checked
          across the whole screen, not just the middle */}
      {isValidating && validationPoints[validationIndex] && (
          <div
            key={validationIndex}
            className="absolute w-6 h-6 bg-red-500 rounded-full border-2 border-white shadow-[0_0_20px_rgba(239,68,68,0.6)] z-50 animate-fade-in"
            style={{
              left: `${validationPoints[validationIndex].x}%`,
              top: `${validationPoints[validationIndex].y}%`,
              transform: 'translate(-50%, -50%)',
            }}
          />
      )}

      {/* Calibration Points - the original 9 during the initial pass, then
          the 4 worst-performing points during the recalibration pass */}
      {!isValidating && activePoints.map((point, index) => {
        const isActive = index === currentPointIndex;
        if (!isActive) return null;

        // Calculate opacity/scale based on clicks
        const fillScale = 1 + (clicksPerPoint * 0.3); 
        const isRecal = phase === 'recalibrate';
        const ringColor = isRecal ? 'bg-orange-400' : 'bg-blue-400';
        const dotColor = isRecal ? 'bg-orange-600' : 'bg-blue-600';
        const crosshairColor = isRecal ? 'bg-orange-400/50' : 'bg-blue-400/50';
        const glowShadowClass = isRecal ? 'shadow-[0_0_30px_rgba(251,146,60,0.5)]' : 'shadow-[0_0_30px_rgba(37,99,235,0.5)]';
        const labelColor = isRecal ? 'text-orange-200' : 'text-blue-200';

        return (
          <button
            key={`${phase}-${point.id}`}
            onClick={handlePointClick}
            disabled={clicksPerPoint >= CLICKS_TO_ADVANCE}
            style={{
              position: 'absolute',
              left: point.x,
              top: point.y,
              transform: 'translate(-50%, -50%)',
            }}
            // Z-index 50 ensures it sits above the video (z-index 10)
            className="group focus:outline-none z-50"
          >
            <span className="relative flex h-16 w-16">
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${ringColor} opacity-30`}></span>
              <span className={`relative inline-flex rounded-full h-16 w-16 ${dotColor} items-center justify-center border-4 border-white ${glowShadowClass} transition-transform active:scale-95`}>
                 {/* Target Crosshair */}
                 <div className={`absolute w-full h-[1px] ${crosshairColor}`}></div>
                 <div className={`absolute h-full w-[1px] ${crosshairColor}`}></div>
                 
                 {/* Inner dot fills up as you click */}
                 <span 
                    className="bg-white rounded-full transition-all duration-300 relative z-10 shadow-inner"
                    style={{ 
                        width: '10px', 
                        height: '10px',
                        transform: `scale(${fillScale})` 
                    }}
                 ></span>
              </span>
            </span>
            <div className={`absolute mt-5 left-1/2 -translate-x-1/2 text-sm ${labelColor} font-mono font-bold pointer-events-none whitespace-nowrap`}>
              {clicksPerPoint}/{CLICKS_TO_ADVANCE}
            </div>
          </button>
        );
      })}
    </div>
  );
};

export default Calibration;