import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useEyeTracking } from '../context/EyeTrackingContext';
import { ImageSessionData, StudyImage, BlinkEvent } from '../types';
import { detectFixations, detectSaccades, aggregateAllMetrics } from '../utils/math';
import { RefreshCw, Eye, Play, Square, Pause } from 'lucide-react';
import { Modal } from '../components/Modal';
import { Button } from '../components/Button';

// Default Images (Fallback)
const DEFAULT_IMAGES: StudyImage[] = [
  { id: 'img1', url: 'https://picsum.photos/id/10/1920/1080', name: 'Forest', duration: 10000 },
  { id: 'img2', url: 'https://picsum.photos/id/20/1920/1080', name: 'Objects', duration: 10000 },
  { id: 'img3', url: 'https://picsum.photos/id/64/1920/1080', name: 'Portrait', duration: 10000 },
  { id: 'img4', url: 'https://picsum.photos/id/175/1920/1080', name: 'Clock', duration: 10000 },
  { id: 'img5', url: 'https://picsum.photos/id/237/1920/1080', name: 'Dog', duration: 10000 },
];

const Study: React.FC = () => {
  const navigate = useNavigate();
  const { 
    startRecording, 
    pauseRecording, 
    resumeRecording, 
    stopRecording, 
    resetSmoothing, 
    adjustOffset, 
    showVideo, 
    currentGaze, 
    needsRecalibration,
    setIsStudyPaused,
    setCurrentImageId,
    trackingQuality,
    lightingReading,
    logExperimentEntry,
  } = useEyeTracking();
  
  const [images, setImages] = useState<StudyImage[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [timeLeft, setTimeLeft] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [alignFeedback, setAlignFeedback] = useState(false);

  const resultsRef = useRef<ImageSessionData[]>([]);
  const startTimeRef = useRef<number>(0);

  // Modal State
  const [modalConfig, setModalConfig] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    type: 'info' | 'success' | 'error' | 'confirm';
    onConfirm?: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    type: 'info'
  });

  const showAlert = (title: string, message: string, type: 'info' | 'success' | 'error' | 'confirm' = 'info', onConfirm?: () => void) => {
    setModalConfig({ isOpen: true, title, message, type, onConfirm });
  };

  // 1. Load configuration on mount
  useEffect(() => {
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

    const loadConfig = () => {
        let userDuration = 10000;
        try {
            const participantStored = localStorage.getItem('participantInfo');
            if (participantStored) {
                const info = JSON.parse(participantStored);
                if (info.displayDuration) {
                    userDuration = parseInt(info.displayDuration) * 1000;
                }
            }
        } catch (e) {
            console.error("Failed to parse participant display duration", e);
        }

        try {
            const storedConfig = sessionStorage.getItem('studyConfig');
            if (storedConfig) {
                const parsed = JSON.parse(storedConfig);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    // Update durations with user preference if it was set
                    const updated = parsed.map((img: StudyImage) => ({
                        ...img,
                        duration: userDuration
                    }));
                    setImages(updated);
                    setIsLoading(false);
                    return;
                }
            }
        } catch (e) {
            console.error("Failed to load custom images", e);
        }
        
        // Fallback with user duration
        setImages(DEFAULT_IMAGES.map(img => ({ ...img, duration: userDuration })));
        setIsLoading(false);
    };

    loadConfig();
  }, []);

  // 2. Keyboard Control for Pause/Resume
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && isPlaying && !isLoading && !modalConfig.isOpen) {
        e.preventDefault();
        togglePause();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPlaying, isPaused, isLoading, modalConfig.isOpen]);

  // 3. Image Setup Tracking (Runs when we start playing, or when the index changes)
  useEffect(() => {
    if (isPlaying && !isLoading && images.length > 0 && currentIndex < images.length) {
        // Just handle tracking and start time recording here
        startTimeRef.current = Date.now();
        setCurrentImageId(images[currentIndex].id);
        
        // Ensure tracking is active and smoothed state is reset for the new stimulus
        resetSmoothing();
        startRecording();
        showVideo(false);
    }
  }, [isPlaying, isLoading, currentIndex, images, setCurrentImageId]); // Dependencies ensure this runs exactly when needed

  // 3. Timer Decrement Effect
  useEffect(() => {
    if (!isPlaying || isLoading || isPaused) return;

    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 0) return 0;
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [isPlaying, isLoading, isPaused]);

  // 4. Completion Monitor Effect
  useEffect(() => {
    // When time hits 0, trigger finish
    if (timeLeft === 0 && isPlaying && !isLoading && !isPaused) {
       finishImage();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeLeft, isPlaying, isLoading]); 

  const finishImage = () => {
    // Stop recording immediately
    const { logs, blinks } = stopRecording();
    const endTime = Date.now();
    const img = images[currentIndex];
    
    if (!img) return; // Safety check

    const totalTimeMs = endTime - startTimeRef.current;
    
    // Retrieve Calibration Score to adapt cluster detection parameters
    const calibrationScoreStr = localStorage.getItem('calibrationScore');
    const calibrationScore = calibrationScoreStr ? parseInt(calibrationScoreStr) : 75;
    
    // Dynamic Quality-Adaptive Spatial Clustering Thresholds 
    // Higher precision calibration allows tighter spatial dispersion bounds while poorer calibration utilizes balanced bands
    const dispersionThresh = calibrationScore >= 85 ? 45 
                           : calibrationScore >= 70 ? 55 
                           : 65;
    const minDur = calibrationScore >= 80 ? 100 : 80;
    
    const fixations = detectFixations(logs, dispersionThresh, minDur);
    const saccades = detectSaccades(fixations);
    
    const estimatedAccuracyPx = Math.max(15, (100 - calibrationScore) * 1.2);

    const advancedMetrics = aggregateAllMetrics(logs, fixations, saccades, blinks, totalTimeMs, estimatedAccuracyPx);

    // Precision from actual logs
    let precision = advancedMetrics.precision;

    const imageData: ImageSessionData = {
      imageId: img.id,
      imageUrl: img.url,
      startTime: startTimeRef.current,
      endTime: endTime,
      screenDimensions: { width: window.innerWidth, height: window.innerHeight },
      gazeLogs: logs,
      fixations,
      saccades,
      blinks,
      quality: {
        accuracy: parseFloat(estimatedAccuracyPx.toFixed(1)), 
        precision: parseFloat(precision.toFixed(1)),
        dataLoss: parseFloat(((1 - (logs.length / (totalTimeMs / 33))) * 100).toFixed(1)) 
      },
      metrics: advancedMetrics
    };

    resultsRef.current.push(imageData);

    if (currentIndex < images.length - 1) {
      // Move straight to the next image - no in-between centre-dot
      // recalibration screen. The slideshow plays all images back-to-back.
      const nextIndex = currentIndex + 1;
      setTimeLeft(images[nextIndex].duration / 1000);
      setCurrentIndex(nextIndex);
    } else {
      // End of study
      concludeStudy();
    }
  };

  const concludeStudy = () => {
      try {
          // Try to save to session storage
          sessionStorage.setItem('studyResults', JSON.stringify(resultsRef.current));
      } catch (e) {
          console.warn("Storage quota exceeded, passing data via state only.");
      }
      // Navigate with state as fallback for large data
      navigate('/results', { state: { data: resultsRef.current } });
  };

  // Ref to hold currentGaze to avoid stale closures in intervals
  const currentGazeRef = useRef(currentGaze);
  useEffect(() => {
      currentGazeRef.current = currentGaze;
  }, [currentGaze]);

  const handleStart = () => {
    if (images.length > 0) {
        setTimeLeft(images[0].duration / 1000);
    }
    setIsPlaying(true);
  };
  
  const handleRecalibrate = () => {
    showAlert(
        "Recalibrate", 
        "Recalibrating will restart the study session. Any unsaved partial data will be lost. Are you sure?", 
        "confirm",
        () => navigate('/calibration')
    );
  };

  const togglePause = () => {
    const nextPaused = !isPaused;
    setIsPaused(nextPaused);
    setIsStudyPaused(nextPaused);
  };

  if (isLoading) {
      return <div className="min-h-screen bg-black flex items-center justify-center text-white">Loading Session...</div>;
  }

  if (!isPlaying) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-black text-white">
        <div className="text-center max-w-lg px-6">
          <h1 className="text-4xl font-bold mb-6">Study Phase</h1>
          <p className="text-lg text-gray-300 mb-8">
            You will be shown {images.length} images. 
            <br />
            Please observe each image naturally. 
            <br />
            Images will display for {images[0]?.duration / 1000 || 10} seconds each.
          </p>
          <button 
            onClick={handleStart}
            className="bg-blue-600 hover:bg-blue-500 text-white px-8 py-4 rounded-full text-xl font-medium transition-all flex items-center justify-center gap-2 mx-auto"
          >
            <Play size={24} fill="currentColor" /> Start Slideshow
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-screen bg-black overflow-hidden cursor-none select-none flex items-center justify-center">
      {images[currentIndex] && (
          <img 
            src={images[currentIndex].url} 
            alt="Study Stimulus" 
            className="w-full h-full object-contain pointer-events-none" 
            id="stimulus-image"
          />
      )}
      
      {/* Real-time Gaze Indicator (Observer View - continues during paused mode!) */}
      {currentGaze && (
        <div 
            className="fixed z-50 pointer-events-none"
            style={{
                left: currentGaze.x,
                top: currentGaze.y,
                transform: 'translate(-50%, -50%)',
                // Explicitly disable CSS transition to avoid artificial lag
                transition: 'none'
            }}
        >
            <div className="relative flex items-center justify-center">
                <div className="w-4 h-4 bg-red-500 rounded-full shadow-[0_0_8px_rgba(255,0,0,0.8)] z-10"></div>
                <div className="absolute w-10 h-10 border-2 border-red-500/50 rounded-full animate-pulse"></div>
                <div className="absolute w-16 h-[1px] bg-red-500/30"></div>
                <div className="absolute h-16 w-[1px] bg-red-500/30"></div>
            </div>
        </div>
      )}
      
      {/* Precision Alignment and Researcher Live Monitor Overlay when paused */}
      {isPaused && (
        <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm z-[55] flex flex-col items-center justify-center p-4">
          <div className="relative flex flex-col items-center max-w-md text-center p-8 bg-slate-900/95 border border-slate-800 rounded-3xl shadow-2xl animate-fade-in mb-6">
            <button
              id="precision-align-target"
              onClick={(e) => {
                e.stopPropagation();
                const centerX = window.innerWidth / 2;
                const centerY = window.innerHeight / 2;
                adjustOffset(centerX, centerY, undefined, undefined, true);
                
                // Show dynamic success feedback
                setAlignFeedback(true);
                setTimeout(() => setAlignFeedback(false), 2000);
                
                // Record click position on WebGazer to teach regression model
                if (window.webgazer) {
                   window.webgazer.recordScreenPosition(centerX, centerY, 'click');
                }
              }}
              className="relative w-28 h-28 flex items-center justify-center group focus:outline-none focus:ring-2 focus:ring-blue-500 rounded-full cursor-pointer transition-all active:scale-95 bg-slate-850 border border-slate-700 hover:border-blue-500/80 hover:bg-slate-805"
              title="Click here to instantly align tracking coordinates"
            >
              {alignFeedback ? (
                <div className="absolute inset-0 flex items-center justify-center bg-emerald-500/20 rounded-full animate-ping pointer-events-none"></div>
              ) : (
                <div className="absolute inset-0 flex items-center justify-center bg-blue-500/10 rounded-full animate-pulse pointer-events-none"></div>
              )}
              
              <div className={`w-20 h-20 rounded-full border-2 ${alignFeedback ? 'border-emerald-500 bg-emerald-500/20' : 'border-blue-500 bg-blue-500/5'} flex items-center justify-center transition-all duration-300`}>
                <div className={`w-12 h-12 rounded-full border-4 ${alignFeedback ? 'border-emerald-400' : 'border-blue-400'} flex items-center justify-center`}>
                  <div className={`w-3 h-3 rounded-full ${alignFeedback ? 'bg-emerald-300 animate-pulse' : 'bg-blue-300'}`}></div>
                </div>
              </div>
              
              {/* Target Crosshairs */}
              <div className={`absolute w-24 h-[1.5px] ${alignFeedback ? 'bg-emerald-500/50' : 'bg-blue-500/30'}`}></div>
              <div className={`absolute h-24 w-[1.5px] ${alignFeedback ? 'bg-emerald-500/50' : 'bg-blue-500/30'}`}></div>
            </button>
            
            <h3 className="text-xl font-bold text-white mt-6 mb-2">
              {alignFeedback ? (
                <span className="text-emerald-400 flex items-center justify-center gap-1.5 animate-pulse">
                  ✓ Eyes Perfectly Aligned!
                </span>
              ) : (
                "🎯 Precision Alignment Target"
              )}
            </h3>
            
            <p className="text-xs text-slate-300 max-w-sm leading-relaxed px-4">
              {alignFeedback ? (
                "Offset calibration successfully set. Your eye coordinates are perfectly synchronized!"
              ) : (
                "If gaze tracker is drifting, look directly at the center of the target and CLICK to re-align instantly."
              )}
            </p>
          </div>

          {currentGaze && (
            <div className="bg-slate-900/95 backdrop-blur-md border border-slate-700/60 text-white rounded-2xl shadow-2xl p-4 flex flex-col md:flex-row items-center gap-6 max-w-2xl w-11/12 animate-fade-in select-none">
              <div className="flex items-center gap-3">
                <span className="relative flex h-3.5 w-3.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-emerald-500"></span>
                </span>
                <div>
                  <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider font-mono">Live Session Status</p>
                  <h4 className="text-xs font-bold text-white font-mono uppercase">Researcher Monitor HUD</h4>
                </div>
              </div>
              
              <div className="h-px md:h-8 w-full md:w-px bg-slate-800"></div>
              
              <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs text-left">
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-400 font-medium">Gaze Position:</span>
                  <span className={`font-mono font-bold ${alignFeedback ? 'text-emerald-400' : 'text-sky-400'}`}>
                    ({Math.round(currentGaze.x)}px, {Math.round(currentGaze.y)}px)
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-400 font-medium font-sans">Focus State:</span>
                  <span className="font-sans font-bold text-indigo-400">
                    {currentGaze.roiId ? "Fixating Target" : "Saccadic Move/Scan"}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 col-span-2">
                  <span className="text-slate-400 font-medium">Viewed Object:</span>
                  <span className="text-emerald-400 font-bold px-2 py-0.5 rounded-lg bg-emerald-950/40 border border-emerald-900/30 text-[10px] uppercase tracking-wider font-mono">
                    {currentGaze.roiId || "Background scanning"}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
      
      {/* Task: Add Stop Button to interrupt study */}
      <div className="absolute top-4 right-4 z-50 flex items-center gap-2">
        <Button 
          variant="outline" 
          onClick={togglePause}
          className="bg-white/80 backdrop-blur border-blue-200 text-blue-600 hover:bg-blue-50 hover:text-blue-700 font-bold px-4 py-2 flex items-center gap-2 pointer-events-auto cursor-pointer"
        >
          {isPaused ? <Play className="w-4 h-4 fill-current" /> : <Pause className="w-4 h-4 fill-current" />}
          {isPaused ? "Resume" : "Pause"}
        </Button>
 
        <Button 
          variant="outline" 
          onClick={() => {
            const wasPaused = isPaused;
            if (!wasPaused) {
              setIsPaused(true);
              setIsStudyPaused(true);
            }
            showAlert(
              "Stop Assessment?", 
              "Are you sure you want to end the assessment now? Data from the images seen so far will be saved.", 
              "confirm",
              () => concludeStudy()
            );
          }}
          className="bg-white/80 backdrop-blur border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 font-bold px-4 py-2 flex items-center gap-2 pointer-events-auto cursor-pointer"
        >
          <Square className="w-4 h-4 fill-current" />
          Stop Assessment
        </Button>
      </div>
 
      {/* Simple Pause Indicator (Top Left) */}
      {isPaused && (
        <div className="absolute top-4 left-4 z-[60] animate-pulse">
            <div className="bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 font-bold shadow-lg">
                <Pause size={16} fill="currentColor" /> Session Paused
            </div>
            <p className="text-[10px] text-white mt-1 drop-shadow-md text-center">Press Space to Resume</p>
        </div>
      )}

      {/* Progress Overlay */}
      <div className="absolute top-0 left-0 w-full h-1 bg-gray-800 z-10">
        <div 
          className="h-full bg-blue-500 transition-all duration-1000 ease-linear"
          style={{ width: `${((currentIndex + 1) / images.length) * 100}%` }}
        />
      </div>

      {/* Recalibration Warning */}
      {needsRecalibration && (
        <div className="absolute top-10 left-1/2 -translate-x-1/2 z-50 bg-red-600/90 text-white px-6 py-3 rounded-xl border border-red-400 shadow-2xl animate-bounce flex items-center gap-3">
          <RefreshCw className="w-5 h-5 animate-spin" />
          <div className="text-left">
             <div className="font-bold text-sm">Low Tracking Accuracy</div>
             <p className="text-[10px] opacity-80">Face lost or tracking drift detected. Please keep head still.</p>
          </div>
        </div>
      )}
      
      {/* Image Timer */}
      <div className="absolute bottom-4 right-4 text-gray-500/50 text-xs font-mono z-10">
         Img {currentIndex + 1}/{images.length} | {timeLeft}s
      </div>
      
      {/* Manual Finish (Hidden fallback for debugging/stuck state) */}
      <div className="absolute top-4 left-4 z-50 opacity-0 hover:opacity-100 transition-opacity">
          <button onClick={finishImage} className="text-xs text-gray-600 bg-white/10 p-2 rounded">Skip</button>
      </div>

      <Modal
          isOpen={modalConfig.isOpen}
          onClose={() => {
              setModalConfig(prev => ({ ...prev, isOpen: false }));
              if (modalConfig.title === "Stop Assessment?") {
                  setIsPaused(false);
                  setIsStudyPaused(false);
              }
          }}
          title={modalConfig.title}
          message={modalConfig.message}
          type={modalConfig.type}
          onConfirm={modalConfig.onConfirm}
        />
    </div>
  );
};

export default Study;