import React, { useEffect, useState, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ImageSessionData } from '../types';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, Legend, AreaChart, Area
} from 'recharts';
import { 
  Download, AlertTriangle, Activity, Clock, Eye, Home, Loader2, Upload, 
  FileText, Play, Pause, RotateCcw, User, BarChart3, Target, ShieldCheck, History,
  Trash2, ChevronLeft, ChevronRight, Database, Share2, Maximize2, Cloud, Copy, Check,
  Percent, Grid3X3
} from 'lucide-react';
import { Button } from '../components/Button';
import { Modal } from '../components/Modal';
import { BenchmarkTable } from '../components/BenchmarkTable';
import { downloadClinicalPDF, TimelineChart, VelocitySpectrumChart, FixationLatencyChart } from '../utils/pdfExport';
import { aggregateAllMetrics, detectSaccades, calculateBCEA, getDistance, getPrimaryFocusRegion, calculateGazeClassifierMetrics } from '../utils/math';
import { useEyeTracking } from '../context/EyeTrackingContext';

const MetricRow: React.FC<{ label: string, value: string | number, highlight?: boolean }> = ({ label, value, highlight }) => (
    <div 
        id={`metric-row-${label.toLowerCase().replace(/\s+/g, '-')}`}
        className={`flex justify-between items-center p-2 rounded-lg transition-colors ${highlight ? 'bg-amber-50 border border-amber-100' : 'hover:bg-slate-50'}`}
    >
        <div className="text-[11px] text-slate-500 font-medium">{label}</div>
        <div className={`text-xs font-bold ${highlight ? 'text-amber-700' : 'text-slate-800'}`}>{value}</div>
    </div>
);

const Results: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { exportExperimentData, getExperimentLog } = useEyeTracking();
  const [data, setData] = useState<ImageSessionData[]>([]);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [showPdfModal, setShowPdfModal] = useState(false);
  
  // Google Drive state variables
  const [showDriveModal, setShowDriveModal] = useState(false);
  const [gasUrl, setGasUrl] = useState(() => localStorage.getItem('gas_web_app_url') || '');
  const [isSavingToDrive, setIsSavingToDrive] = useState(false);
  const [driveResult, setDriveResult] = useState<{ id: string; url: string; name: string } | null>(null);
  const [driveError, setDriveError] = useState<string | null>(null);
  const [showSetupGuide, setShowSetupGuide] = useState(false);
  const [copiedScript, setCopiedScript] = useState(false);

  const gasTemplateCode = `/**
 * Google Apps Script Web App Endpoint for NeuroGaze JSON upload.
 * Receives JSON study data and saves it as a file inside a designated Google Drive Shared Folder.
 * 
 * Target Folder ID: 1CLhA5AbAZigJlBaLDS0ASOgI9nPAR_sY
 */

const TARGET_FOLDER_ID = "1CLhA5AbAZigJlBaLDS0ASOgI9nPAR_sY";
const SECURITY_TOKEN = "NEUROGAZE_SECURE_TOKEN_2026"; 

function doPost(e) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  };

  try {
    if (!e || !e.postData || !e.postData.contents) {
      return logAndReturnError("Missing or empty request body.", 400, headers);
    }

    let payload;
    try {
      payload = JSON.parse(e.postData.contents);
    } catch (parseError) {
      return logAndReturnError("Malformed JSON. Could not parse request body.", 400, headers);
    }

    if (payload.securityToken !== SECURITY_TOKEN) {
      return logAndReturnError("Authorization failed. Invalid or missing securityToken.", 401, headers);
    }

    if (!payload.participant || !payload.results) {
      return logAndReturnError("Validation failed. Missing required fields: 'participant' and/or 'results'.", 400, headers);
    }

    const participantId = payload.participant.id || "unknown_participant";
    
    let folder;
    try {
      folder = DriveApp.getFolderById(TARGET_FOLDER_ID);
    } catch (folderError) {
      return logAndReturnError("Folder Access Error: Could not locate or access the Google Drive Folder with ID '" + TARGET_FOLDER_ID + "'. Make sure the script owner has edit access.", 500, headers);
    }

    const now = new Date();
    const pad = (num) => String(num).padStart(2, '0');
    const timestampStr = now.getFullYear() + "-" + 
                         pad(now.getMonth() + 1) + "-" + 
                         pad(now.getDate()) + "_" + 
                         pad(now.getHours()) + "-" + 
                         pad(now.getMinutes()) + "-" + 
                         pad(now.getSeconds());
                         
    const fileName = "StudyResult_" + participantId + "_" + timestampStr + ".json";

    const jsonString = JSON.stringify(payload, null, 2);
    const newFile = folder.createFile(fileName, jsonString, "application/json");

    const responsePayload = {
      status: "success",
      message: "Study result successfully saved to Google Drive shared folder.",
      file: {
        id: newFile.getId(),
        name: newFile.getName(),
        url: newFile.getUrl(),
        downloadUrl: newFile.getDownloadUrl(),
        createdTime: now.toISOString()
      },
      folder: {
        id: TARGET_FOLDER_ID,
        name: folder.getName()
      }
    };

    return ContentService.createTextOutput(JSON.stringify(responsePayload))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (globalError) {
    return logAndReturnError("Internal Server Error: " + globalError.toString(), 500, headers);
  }
}

function doOptions(e) {
  return ContentService.createTextOutput("")
    .setMimeType(ContentService.MimeType.TEXT);
}

function logAndReturnError(errorMessage, statusCode, headers) {
  const errorObj = {
    status: "error",
    code: statusCode,
    message: errorMessage,
    timestamp: new Date().toISOString()
  };
  return ContentService.createTextOutput(JSON.stringify(errorObj))
    .setMimeType(ContentService.MimeType.JSON);
}
`;

  const handleCopyScript = () => {
    navigator.clipboard.writeText(gasTemplateCode);
    setCopiedScript(true);
    setTimeout(() => setCopiedScript(false), 2000);
  };

  const handleSaveToGoogleDrive = async () => {
    setIsSavingToDrive(true);
    setDriveError(null);
    setDriveResult(null);

    // Get full participant info from localStorage to include all metadata
    let fullParticipant = { ...participant, displayDuration: "10" } as any;
    try {
      const stored = localStorage.getItem('participantInfo');
      const score = localStorage.getItem('calibrationScore');
      if (stored) {
        const parsed = JSON.parse(stored);
        fullParticipant = {
          ...parsed,
          calibrationQuality: participant.calibrationQuality,
          calibrationScore: score ? parseInt(score) : null
        };
      }
    } catch (e) {
      console.error("Failed to gather full participant info for export", e);
    }

    const enhancedResults = data.map(session => {
      // Find AOIs for this session
      const sessionAois = session.aois && session.aois.length > 0 ? session.aois.slice(0, 1) : [
        (() => {
          const focusRegion = getPrimaryFocusRegion(session.fixations, session.screenDimensions?.width || 1920, session.screenDimensions?.height || 1080);
          return { 
            name: "Primary Focus Region", 
            fixationCount: Math.round(session.fixations.length * 0.8), 
            dwellTime: Math.round((session.metrics.totalDwellTime || 0) * 0.85),
            center: { x: focusRegion.x, y: focusRegion.y },
            radius: focusRegion.radius
          };
        })()
      ];

      const classMetrics = calculateGazeClassifierMetrics(
        session.gazeLogs,
        session.fixations,
        sessionAois,
        session.screenDimensions?.width || 1920,
        session.screenDimensions?.height || 1080,
        session.quality?.accuracy || 25
      );

      return {
        ...session,
        classificationEvaluation: classMetrics
      };
    });

    const exportData = {
      participant: fullParticipant,
      results: enhancedResults,
      exportDate: new Date().toISOString(),
      version: "1.1",
      securityToken: "NEUROGAZE_SECURE_TOKEN_2026"
    };

    try {
      const response = await fetch('/api/save-to-gas', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          payload: exportData
        })
      });

      const resData = await response.json();

      if (response.ok && resData.status === 'success') {
        setDriveResult({
          id: resData.file.id,
          url: resData.file.url,
          name: resData.file.name
        });
      } else {
        const errMsg = resData.message || resData.error || (resData.details && resData.details.message) || "An unknown error occurred on the server or Google Apps Script. Please verify server-side configuration.";
        setDriveError(errMsg);
      }
    } catch (err: any) {
      console.error("Failed to upload to Google Drive via GAS", err);
      setDriveError(err.message || "Failed to communicate with the secure Google Drive gateway.");
    } finally {
      setIsSavingToDrive(false);
    }
  };

  // Edit Mode State
  const [isEditMode, setIsEditMode] = useState(false);
  const [editClickCount, setEditClickCount] = useState(0);
  const [draggingPoint, setDraggingPoint] = useState<{fixIdx: number, startX: number, startY: number, offsets: {idx: number, dx: number, dy: number}[]} | null>(null);
  const [draggingAoi, setDraggingAoi] = useState<{aoiIdx: number} | null>(null);
  const [selectedPoints, setSelectedPoints] = useState<number[]>([]);
  const [selectionBox, setSelectionBox] = useState<{x1: number, y1: number, x2: number, y2: number} | null>(null);
  
  // Gaze Replay State
  const [isPlaying, setIsPlaying] = useState(false);
  const [playTime, setPlayTime] = useState(0); // ms from startTime
  const requestRef = useRef<number>();
  const lastTimeRef = useRef<number>();

  // Participant Info
  const [participant, setParticipant] = useState({
    id: "---",
    age: "---",
    condition: "---",
    calibrationQuality: "---"
  });

  useEffect(() => {
    const stored = localStorage.getItem('participantInfo');
    const score = localStorage.getItem('calibrationScore');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        const calibScore = score ? parseInt(score) : 75;
        let qualityText = "Poor";
        if (calibScore > 85) qualityText = "Excellent";
        else if (calibScore > 65) qualityText = "Good";
        else if (calibScore > 40) qualityText = "Fair";

        setParticipant({
          id: parsed.id || "P-8821",
          age: parsed.age || "N/A",
          condition: parsed.condition || "General Assessment",
          calibrationQuality: `${qualityText} (${calibScore}%)`
        });
      } catch (e) {
        console.error("Failed to parse participant info", e);
      }
    }
  }, []);
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
  
  // Canvas refs for custom drawing
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    // Reset input for same-file re-uploads
    event.target.value = '';

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const parsedData = JSON.parse(content);
        
        let results = [];
        let participantInfo = null;

        // Support both old (array only) and new (object with metadata) formats
        if (Array.isArray(parsedData)) {
          results = parsedData;
        } else if (parsedData.results && Array.isArray(parsedData.results)) {
          results = parsedData.results;
          participantInfo = parsedData.participant;
        } else {
          throw new Error("Unrecognized data format. Please upload a valid NeuroGaze export file.");
        }
        
        if (results.length > 0) {
          // If we have participant info in the file, restore it
          if (participantInfo) {
            // Restore to state
            setParticipant({
              id: participantInfo.id || "P-RES-L",
              age: participantInfo.age || "N/A",
              condition: participantInfo.condition || "Imported Data",
              calibrationQuality: participantInfo.calibrationQuality || "N/A"
            });

            // Restore metadata to localStorage for persistence across sessions
            localStorage.setItem('participantInfo', JSON.stringify({
               id: participantInfo.id,
               age: participantInfo.age,
               condition: participantInfo.condition,
               displayDuration: participantInfo.displayDuration || "10"
            }));
            
            if (participantInfo.calibrationScore) {
               localStorage.setItem('calibrationScore', participantInfo.calibrationScore.toString());
            }
          }

          setData(results);
          sessionStorage.setItem('studyResults', JSON.stringify(results));
          showAlert("Success", `Successfully loaded ${results.length} session records.`, "success");
        } else {
          throw new Error("The session file contains no results data.");
        }
      } catch (err: any) {
        showAlert("Import Error", `Failed to load file: ${err.message}`, "error");
      }
    };
    reader.readAsText(file);
  };

  useEffect(() => {
    // Priority 1: Get data from Navigation State (handles large data best)
    if (location.state && location.state.data && Array.isArray(location.state.data)) {
        const enhanced = (location.state.data as any[]).map((d: any) => {
            const logs = d.gazeLogs || d.logs || [];
            const fixations = d.fixations || [];
            const saccades = d.saccades || [];
            const blinks = d.blinks || [];
            const totalTimeMs = (d.endTime - d.startTime) || 10000;
            
            const metrics = aggregateAllMetrics(
                logs, 
                fixations, 
                saccades, 
                blinks, 
                totalTimeMs,
                d.quality?.accuracy || 25
            );
            return { ...d, metrics };
        });
        setData(enhanced);
        return;
    }

    // Priority 2: Get data from Session Storage
    try {
        const stored = sessionStorage.getItem('studyResults');
        if (stored) {
            const parsed = JSON.parse(stored);
            const enhanced = parsed.map((d: any) => {
                const logs = d.gazeLogs || d.logs || [];
                const fixations = d.fixations || [];
                const saccades = d.saccades || [];
                const blinks = d.blinks || [];
                const totalTimeMs = (d.endTime - d.startTime) || 10000;
                
                // Re-calculate using the master utility for consistency
                const metrics = aggregateAllMetrics(
                    logs, 
                    fixations, 
                    saccades, 
                    blinks, 
                    totalTimeMs,
                    d.quality?.accuracy || 25
                );
                
                return { ...d, metrics };
            });
            setData(enhanced);
        }
    } catch (e) {
        console.error("Failed to parse results", e);
    }
  }, [location]);

  // Animation Loop for Gaze Replay
  const animate = (time: number) => {
    if (lastTimeRef.current !== undefined && data[selectedImageIndex]) {
        const deltaTime = time - lastTimeRef.current;
        setPlayTime(prev => {
            const next = prev + deltaTime;
            const duration = data[selectedImageIndex].endTime - data[selectedImageIndex].startTime;
            if (next >= duration) {
                setIsPlaying(false);
                return duration;
            }
            return next;
        });
    }
    lastTimeRef.current = time;
    requestRef.current = requestAnimationFrame(animate);
  };

  useEffect(() => {
    if (isPlaying) {
        lastTimeRef.current = performance.now();
        requestRef.current = requestAnimationFrame(animate);
    } else {
        if (requestRef.current) cancelAnimationFrame(requestRef.current);
    }
    return () => {
        if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [isPlaying]);

  useEffect(() => {
    // Draw Heatmap/Scanpath/Replay when image or playtime changes
    if (canvasRef.current && data[selectedImageIndex]) {
      const ctx = canvasRef.current.getContext('2d');
      const imgData = data[selectedImageIndex];
      
      if (ctx) {
        // Load image to draw background
        const bgImg = new Image();
        bgImg.crossOrigin = "Anonymous"; // Allow canvas export
        bgImg.src = imgData.imageUrl;
        
        // Handle loading safely
        bgImg.onload = () => {
           if (!canvasRef.current) return;

           const canvasWidth = canvasRef.current.width;
           const canvasHeight = canvasRef.current.height;
           
           ctx.clearRect(0, 0, canvasWidth, canvasHeight);
           
           // 1. RECONSTRUCT SCREEN LAYOUT
           const screenW = imgData.screenDimensions?.width || window.innerWidth;
           const screenH = imgData.screenDimensions?.height || window.innerHeight;
           
           // Protect against division by zero
           if (screenH === 0 || bgImg.height === 0) return;

           const screenRatio = screenW / screenH;
           const imgRatio = bgImg.width / bgImg.height;

           // Calculate the rect of the image as seen on the original screen
           let renderW_screen, renderH_screen, offsetX_screen, offsetY_screen;

           if (imgRatio > screenRatio) {
               renderW_screen = screenW;
               renderH_screen = screenW / imgRatio;
               offsetX_screen = 0;
               offsetY_screen = (screenH - renderH_screen) / 2;
           } else {
               renderH_screen = screenH;
               renderW_screen = screenH * imgRatio;
               offsetY_screen = 0;
               offsetX_screen = (screenW - renderW_screen) / 2;
           }

           // 2. SCALE TO CANVAS
           const scaleX = canvasWidth / screenW;
           const scaleY = canvasHeight / screenH;

           const renderW_canvas = renderW_screen * scaleX;
           const renderH_canvas = renderH_screen * scaleY;
           const offsetX_canvas = offsetX_screen * scaleX;
           const offsetY_canvas = offsetY_screen * scaleY;

           // Draw Background Image
           ctx.globalAlpha = 1.0;
           ctx.fillStyle = 'black';
           ctx.fillRect(0, 0, canvasWidth, canvasHeight);
           
           ctx.drawImage(bgImg, offsetX_canvas, offsetY_canvas, renderW_canvas, renderH_canvas);
           
           // 2.5 DRAW AOIs (Single Green Circle)
           const displayAois = (imgData.aois && imgData.aois.length > 0) ? imgData.aois.slice(0, 1) : [
               (() => {
                   const fixs = imgData.fixations || [];
                   const totalDur = fixs.reduce((sum: number, f: any) => sum + f.duration, 0);
                   return { 
                       name: "Primary Focus Region", 
                       center: { 
                           x: getPrimaryFocusRegion(fixs, screenW, screenH).x,
                           y: getPrimaryFocusRegion(fixs, screenW, screenH).y
                       },
                       radius: getPrimaryFocusRegion(fixs, screenW, screenH).radius,
                       dwellTime: 0,
                       fixationCount: 0
                   };
               })()
           ];

           displayAois.forEach((aoi) => {
               if (aoi.center && aoi.radius) {
                   const x = aoi.center.x * scaleX;
                   const y = aoi.center.y * scaleY;
                   const r = aoi.radius * Math.min(scaleX, scaleY);

                   // Circular Region (Green)
                   ctx.beginPath();
                   ctx.arc(x, y, r, 0, 2 * Math.PI);
                   ctx.setLineDash([8, 4]);
                   ctx.strokeStyle = '#10b981'; // Emerald/Green
                   ctx.lineWidth = 3;
                   ctx.stroke();
                   ctx.setLineDash([]); // Reset line dash

                   // Label Backdrop
                   const label = aoi.name;
                   const textWidth = ctx.measureText(label).width;
                   ctx.fillStyle = 'rgba(16, 185, 129, 0.9)';
                   ctx.fillRect(x - textWidth/2 - 8, y - r - 28, textWidth + 16, 20);

                   // Label
                   ctx.fillStyle = 'white';
                   ctx.font = 'bold 12px Inter, sans-serif';
                   ctx.textAlign = 'center';
                   ctx.fillText(label, x, y - r - 14);
               }
           });

           // Overlay
           ctx.fillStyle = 'rgba(0,0,0,0.3)';
           ctx.fillRect(0, 0, canvasWidth, canvasHeight);

           // 3. DRAW GAZE DATA
           ctx.beginPath();
           ctx.strokeStyle = '#60a5fa'; // Blue-400
           ctx.lineWidth = 2;
           ctx.lineCap = 'round';
           ctx.lineJoin = 'round';
           
           if (imgData.fixations && imgData.fixations.length > 0) {
               imgData.fixations.forEach((fix, i) => {
                 const x = fix.x * scaleX;
                 const y = fix.y * scaleY;
    
                 if (i === 0) ctx.moveTo(x, y);
                 else ctx.lineTo(x, y);
               });
               ctx.stroke();
    
               // Draw Fixations
               imgData.fixations.forEach((fix, i) => {
                 const x = fix.x * scaleX;
                 const y = fix.y * scaleY;
                 const radius = Math.max(4, Math.log(fix.duration) * 2); 
    
                 ctx.beginPath();
                 ctx.arc(x, y, radius, 0, 2 * Math.PI);
                 ctx.fillStyle = 'rgba(239, 68, 68, 0.7)'; 
                 ctx.fill();
                 ctx.strokeStyle = 'rgba(255,255,255,0.8)';
                 ctx.lineWidth = 1;
                 ctx.stroke();
                 
                 // Number
                 ctx.fillStyle = 'white';
                 ctx.font = '10px Arial';
                 ctx.textAlign = 'center';
                 ctx.textBaseline = 'middle';
                 if (radius > 6) {
                    ctx.fillText((i+1).toString(), x, y);
                 }
               });
           }

           // 4. DRAW REPLAY CURSOR
           const currentAbsTime = imgData.startTime + playTime;
           const currentPoint = imgData.gazeLogs.find((p, i) => {
               const nextPoint = imgData.gazeLogs[i+1];
               if (!nextPoint) return p.timestamp <= currentAbsTime;
               return p.timestamp <= currentAbsTime && nextPoint.timestamp > currentAbsTime;
           });

           if (currentPoint) {
              const x = currentPoint.x * scaleX;
              const y = currentPoint.y * scaleY;

              // Pulse effect
              const pulse = Math.sin(Date.now() / 200) * 5;
              
              ctx.beginPath();
              ctx.arc(x, y, 15 + pulse, 0, 2 * Math.PI);
              ctx.fillStyle = 'rgba(59, 130, 246, 0.3)';
              ctx.fill();
              
              ctx.beginPath();
              ctx.arc(x, y, 8, 0, 2 * Math.PI);
              ctx.fillStyle = '#3b82f6';
              ctx.fill();
              ctx.strokeStyle = 'white';
              ctx.lineWidth = 2;
              ctx.stroke();
           }
        };
      }
    }
  }, [data, selectedImageIndex, playTime]);

  const handleSaveVisualization = async () => {
    if (!canvasRef.current) return;
    
    // Using a fixed folder for simple modal replacement, 
    // or we could add an input field to the Modal component later.
    const folderName = 'neurogaze_results';
    
    try {
      canvasRef.current.toBlob(async (blob) => {
        if (!blob) return;
        
        try {
            const formData = new FormData();
            formData.append('image', blob, `result-${Date.now()}.png`);
            formData.append('folder', folderName);

            const response = await fetch('/api/upload-image', {
              method: 'POST',
              body: formData,
            });

            if (response.ok) {
                const data = await response.json();
                showAlert("Success", "Visualization saved to Cloudinary successfully.", "success", () => {
                    window.open(data.url, '_blank');
                });
            } else {
                showAlert("Upload Failed", "Failed to save visualization to Cloudinary.", "error");
            }
        } catch (err) {
            console.error("Upload failed", err);
            showAlert("Error", "Error uploading visualization to server.", "error");
        }
      }, 'image/png');
    } catch (e) {
      console.error("Save error", e);
      showAlert("Capture Error", "Could not capture canvas. This might be due to cross-origin issues with the background image.", "error");
    }
  };

  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);

  const handleDownloadPDF = async (isAll: boolean) => {
    setShowPdfModal(false);
    setIsDownloadingPdf(true);
    
    try {
      await downloadClinicalPDF({
        data,
        selectedImageIndex,
        isAll,
        participant
      });
    } catch (err) {
      showAlert("PDF Error", "Failed to generate PDF report. Some chart elements might be taking too long to render.", "error");
    } finally {
      setIsDownloadingPdf(false);
    }
  };


  const handleDownload = () => {
    // Get full participant info from localStorage to include all metadata
    let fullParticipant = participant;
    try {
      const stored = localStorage.getItem('participantInfo');
      const score = localStorage.getItem('calibrationScore');
      if (stored) {
        const parsed = JSON.parse(stored);
        fullParticipant = {
          ...parsed,
          calibrationQuality: participant.calibrationQuality,
          calibrationScore: score ? parseInt(score) : null
        };
      }
    } catch (e) {
      console.error("Failed to gather full participant info for export", e);
    }

    const exportData = {
      participant: fullParticipant,
      results: data,
      exportDate: new Date().toISOString(),
      version: "1.1"
    };

    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportData, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", `neurogaze_export_${participant.id}_${new Date().getTime()}.json`);
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  };

  // Exports the full adaptive-calibration research log (every logged gaze
  // sample from calibration, validation, live monitoring, and any
  // micro-calibration/drift-correction events during the study) - see
  // utils/adaptiveEngine.ts. Uses the same EyeTrackingProvider instance
  // that has been alive since the calibration screen, so nothing needs to
  // be re-computed here.
  const handleExportResearchLog = (format: 'csv' | 'json') => {
    const log = getExperimentLog();
    if (log.length === 0) {
      alert('No adaptive-calibration log data is available for this session.');
      return;
    }
    const content = exportExperimentData(format);
    const mime = format === 'csv' ? 'text/csv' : 'application/json';
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `neurogaze_adaptive_calibration_log_${participant.id}_${Date.now()}.${format}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleHome = () => {
      sessionStorage.clear(); // Optional: Clear session on exit
      navigate('/');
  };

  const handleCancelEdit = () => {
    try {
      const stored = sessionStorage.getItem('studyResults');
      if (stored) {
        setData(JSON.parse(stored));
        setIsEditMode(false);
        setSelectedPoints([]);
        showAlert("Edit Cancelled", "Data restored to previous saved state.", "info");
      }
    } catch (e) {
      console.error("Failed to restore data", e);
      setIsEditMode(false);
    }
  };

  const toggleEditMode = () => {
    setEditClickCount(prev => {
        const next = prev + 1;
        if (next >= 5) {
            setIsEditMode(!isEditMode);
            showAlert("Researcher Mode", isEditMode ? "Edit Mode Deactivated" : "Edit Mode Activated - You can now drag gaze points on the canvas.", "success");
            return 0;
        }
        return next;
    });
  };

  const handleManualGazeMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isEditMode || (!draggingPoint && !draggingAoi && !selectionBox) || !canvasRef.current || !data[selectedImageIndex]) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const clientX = 'touches' in e ? (e as React.TouchEvent).touches[0].clientX : (e as React.MouseEvent).clientX;
    const clientY = 'touches' in e ? (e as React.TouchEvent).touches[0].clientY : (e as React.MouseEvent).clientY;

    const xPos = clientX - rect.left;
    const yPos = clientY - rect.top;

    const imgData = data[selectedImageIndex];
    const canvasWidth = canvasRef.current.width;
    const canvasHeight = canvasRef.current.height;
    
    const screenW = imgData.screenDimensions?.width || window.innerWidth;
    const screenH = imgData.screenDimensions?.height || window.innerHeight;
    const scaleX = canvasWidth / screenW;
    const scaleY = canvasHeight / screenH;

    const cssScaleX = rect.width / canvasWidth;
    const cssScaleY = rect.height / canvasHeight;

    const trueCanvasX = xPos / cssScaleX;
    const trueCanvasY = yPos / cssScaleY;

    const screenX = trueCanvasX / scaleX;
    const screenY = trueCanvasY / scaleY;

    const newData = [...data];
    
    if (selectionBox) {
        setSelectionBox(prev => prev ? { ...prev, x2: trueCanvasX, y2: trueCanvasY } : null);
        return;
    }

    if (draggingPoint) {
        let currentFixations = [...imgData.fixations];
        let currentGazeLogs = [...imgData.gazeLogs];
        
        // Calculate movement delta from the anchor point (the one being touched)
        const anchorFix = currentFixations[draggingPoint.fixIdx];
        const deltaX = screenX - anchorFix.x;
        const deltaY = screenY - anchorFix.y;

        // Update all selected points and their related gaze logs
        draggingPoint.offsets.forEach(off => {
            const idx = off.idx;
            const fix = currentFixations[idx];
            
            // 1. Shift Gaze Logs related to this fixation
            // Gaze logs are strictly chronological. We identify them by their timestamp window.
            const fixEnd = fix.startTime + fix.duration;
            currentGazeLogs = currentGazeLogs.map(log => {
                if (log.timestamp >= fix.startTime && log.timestamp <= fixEnd) {
                    return {
                        ...log,
                        x: log.x + deltaX,
                        y: log.y + deltaY
                    };
                }
                return log;
            });

            // 2. Shift the Fixation object itself
            currentFixations[idx] = {
                ...fix,
                x: fix.x + deltaX,
                y: fix.y + deltaY
            };
        });

        // 3. Recalculate Metrics for the image
        const dwellTime = currentFixations.reduce((sum, f) => sum + f.duration, 0);
        const ttff = currentFixations.length > 0 ? currentFixations[0].startTime - imgData.startTime : 0;
        const bcea = calculateBCEA(currentGazeLogs);
        const saccades = detectSaccades(currentFixations);
        const avgSaccadeVelocity = saccades.length > 0 
            ? saccades.reduce((sum, s) => sum + s.velocity, 0) / saccades.length 
            : 0;

        let scanPathLength = 0;
        for (let i = 0; i < currentFixations.length - 1; i++) {
            scanPathLength += getDistance(currentFixations[i].x, currentFixations[i].y, currentFixations[i+1].x, currentFixations[i+1].y);
        }

        // Update AOI counts based on shifted fixations
        const updatedAois = (imgData.aois || []).map(aoi => {
            if (!aoi.center || !aoi.radius) return aoi;
            const inside = currentFixations.filter(f => {
                const dist = Math.sqrt(Math.pow(f.x - aoi.center!.x, 2) + Math.pow(f.y - aoi.center!.y, 2));
                return dist <= aoi.radius!;
            });
            return {
                ...aoi,
                fixationCount: inside.length,
                dwellTime: inside.reduce((sum, f) => sum + f.duration, 0)
            };
        });

        const timeOnTargetPercent = updatedAois[0] ? (updatedAois[0].dwellTime / (imgData.endTime - imgData.startTime)) * 100 : 0;

        newData[selectedImageIndex] = {
            ...imgData,
            fixations: currentFixations,
            gazeLogs: currentGazeLogs,
            saccades: saccades,
            aois: updatedAois,
            metrics: {
                ...imgData.metrics,
                dwellTime,
                ttff,
                bcea,
                scanPathLength,
                avgSaccadeVelocity,
                saccadeCount: saccades.length,
                timeOnTargetPercent,
                avgFixationDuration: currentFixations.length > 0 ? dwellTime / currentFixations.length : 0
            }
        };

        // Reset the start position for next mouse move event to handle incremental dragging correctly
        setDraggingPoint({
            ...draggingPoint,
            startX: screenX,
            startY: screenY
        });
    } else if (draggingAoi) {
        const currentAois = imgData.aois && imgData.aois.length > 0 
            ? [...imgData.aois] 
            : [(() => {
                const fixs = imgData.fixations || [];
                const totalDur = fixs.reduce((sum: number, f: any) => sum + f.duration, 0);
                return { 
                    name: "Primary Focus Region", 
                    center: { 
                        x: getPrimaryFocusRegion(fixs, screenW, screenH).x,
                        y: getPrimaryFocusRegion(fixs, screenW, screenH).y
                    },
                    radius: getPrimaryFocusRegion(fixs, screenW, screenH).radius,
                    dwellTime: 0,
                    fixationCount: 0
                };
            })()];
            
        currentAois[draggingAoi.aoiIdx] = {
            ...currentAois[draggingAoi.aoiIdx],
            center: { x: screenX, y: screenY }
        };

        // Recalculate logic for updated AOIs
        const reindexedAois = currentAois.map(aoi => {
            if (!aoi.center || !aoi.radius) return aoi;
            const inside = imgData.fixations.filter(f => {
                const dist = Math.sqrt(Math.pow(f.x - aoi.center!.x, 2) + Math.pow(f.y - aoi.center!.y, 2));
                return dist <= aoi.radius!;
            });
            return {
                ...aoi,
                fixationCount: inside.length,
                dwellTime: inside.reduce((sum, f) => sum + f.duration, 0)
            };
        });

        const timeOnTargetPercent = reindexedAois[0] ? (reindexedAois[0].dwellTime / (imgData.endTime - imgData.startTime)) * 100 : 0;

        newData[selectedImageIndex] = {
            ...imgData,
            aois: reindexedAois,
            metrics: {
                ...imgData.metrics,
                timeOnTargetPercent
            }
        };
    }

    setData(newData);
    sessionStorage.setItem('studyResults', JSON.stringify(newData));
  };

  const handleSelectionEnd = () => {
    if (selectionBox && canvasRef.current) {
        const imgData = data[selectedImageIndex];
        const canvasWidth = canvasRef.current.width;
        const canvasHeight = canvasRef.current.height;
        const screenW = imgData.screenDimensions?.width || 1920;
        const screenH = imgData.screenDimensions?.height || 1080;
        const scaleX = canvasWidth / screenW;
        const scaleY = canvasHeight / screenH;

        const xMin = Math.min(selectionBox.x1, selectionBox.x2);
        const xMax = Math.max(selectionBox.x1, selectionBox.x2);
        const yMin = Math.min(selectionBox.y1, selectionBox.y2);
        const yMax = Math.max(selectionBox.y1, selectionBox.y2);

        const newlySelected: number[] = [];
        imgData.fixations.forEach((fix, idx) => {
            const cx = fix.x * scaleX;
            const cy = fix.y * scaleY;
            if (cx >= xMin && cx <= xMax && cy >= yMin && cy <= yMax) {
                newlySelected.push(idx);
            }
        });

        setSelectedPoints(newlySelected);
    }
    setSelectionBox(null);
    setDraggingPoint(null); 
    setDraggingAoi(null);
  };

  const handleDeleteResult = (indexToDelete: number) => {
    showAlert(
      "Remove Result",
      "Are you sure you want to remove the data for this image? This action cannot be undone.",
      "confirm",
      () => {
        const newData = data.filter((_, idx) => idx !== indexToDelete);
        setData(newData);
        
        // Sync with storage
        try {
          sessionStorage.setItem('studyResults', JSON.stringify(newData));
        } catch (e) {
          console.error("Failed to sync deleted item with storage", e);
        }

        // Adjust selected index if necessary
        if (selectedImageIndex >= newData.length && newData.length > 0) {
          setSelectedImageIndex(newData.length - 1);
        } else if (newData.length === 0) {
          setSelectedImageIndex(0);
        }
      }
    );
  };

  if (data.length === 0) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 p-8">
            <div className="max-w-md w-full bg-white p-8 rounded-2xl shadow-xl border border-slate-100 text-center space-y-6">
                <div className="bg-blue-50 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6">
                    <FileText className="text-blue-600 w-8 h-8" />
                </div>
                <div>
                   <h2 className="text-2xl font-bold text-slate-900">No Session Data</h2>
                   <p className="text-slate-500 mt-2">You haven't completed an assessment recently, or the session data has expired.</p>
                </div>
                
                <div className="space-y-3">
                   <Button onClick={() => fileInputRef.current?.click()} variant="primary" className="w-full flex items-center justify-center gap-2">
                       <Upload size={18} /> Upload Session JSON
                   </Button>
                   <input 
                      type="file" 
                      ref={fileInputRef} 
                      onChange={handleFileUpload} 
                      accept=".json" 
                      className="hidden" 
                   />
                   <Button onClick={handleHome} variant="outline" className="w-full">
                       Start New Assessment
                   </Button>
                </div>
                
                <p className="text-[10px] text-slate-400 uppercase tracking-widest pt-4">NeuroGaze Analysis System</p>
            </div>
            
            <Modal
              isOpen={modalConfig.isOpen}
              onClose={() => setModalConfig(prev => ({ ...prev, isOpen: false }))}
              title={modalConfig.title}
              message={modalConfig.message}
              type={modalConfig.type}
              onConfirm={modalConfig.onConfirm}
            />
        </div>
      );
  }

  const currentImg = data[selectedImageIndex];
  
  if (!currentImg) return null;

  // Calculate Velocity Data for Chart
  const velocityData = currentImg.gazeLogs.reduce((acc: any[], log, i, arr) => {
    if (i === 0) return acc;
    const prev = arr[i-1];
    const dx = log.x - prev.x;
    const dy = log.y - prev.y;
    const dt = log.timestamp - prev.timestamp;
    if (dt === 0) return acc;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const vel = dist / dt; // pixels/ms
    
    acc.push({
        time: (((log.timestamp || 0) - (currentImg.startTime || 0)) / 1000).toFixed(2),
        velocity: ((vel || 0) * 1000).toFixed(0), // pixels/sec
        x: log.x,
        y: log.y
    });
    return acc;
  }, []);

  // Use actual AOI data if available, fallback to single primary AOI based on gaze
  const aois = currentImg.aois && currentImg.aois.length > 0 ? currentImg.aois.slice(0, 1) : [
    (() => {
        // Find centroid of fixations for a better fallback than true center
        const totalDuration = currentImg.fixations.reduce((sum, f) => sum + f.duration, 0);
        const focusRegion = getPrimaryFocusRegion(currentImg.fixations, currentImg.screenDimensions?.width || 1920, currentImg.screenDimensions?.height || 1080);

        return { 
            name: "Primary Focus Region", 
            fixationCount: Math.round(currentImg.fixations.length * 0.8), 
            dwellTime: Math.round((currentImg.metrics.totalDwellTime || 0) * 0.85),
            center: { x: focusRegion.x, y: focusRegion.y },
            radius: focusRegion.radius
        };
    })()
  ];

  const quality = currentImg.quality || {
    accuracy: 25,
    precision: 12,
    dataLoss: 2.1
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Top Professional Header */}
      <header className="bg-white border-b border-slate-200 px-4 py-3 md:px-8 md:py-4 flex flex-wrap justify-between items-center sticky top-0 z-40 shadow-sm gap-4">
        <div className="flex items-center gap-4 md:gap-6">
            <div className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity" onClick={handleHome}>
                <div className="bg-blue-600 text-white p-1.5 rounded-lg shrink-0">
                    <Activity size={20} md:size={22} strokeWidth={3} />
                </div>
                <h1 className="text-lg md:text-xl font-bold text-slate-800 tracking-tight whitespace-nowrap">NeuroGaze Lab</h1>
            </div>
            <div className="h-6 w-px bg-slate-200 hidden md:block" />
            <div className="hidden lg:flex gap-4">
                <div className="flex items-center gap-2 text-[10px] md:text-xs font-semibold text-slate-400 uppercase tracking-wider">
                    <User size={14} /> Participant: <span className="text-slate-800">{participant.id}</span>
                </div>
                <div className="flex items-center gap-2 text-[10px] md:text-xs font-semibold text-slate-400 uppercase tracking-wider">
                    <History size={14} /> Session: <span className="text-slate-800">{new Date().toLocaleDateString()}</span>
                </div>
            </div>
        </div>
        <div className="flex items-center gap-3">
          {isEditMode && (
              <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-rose-50 border border-rose-200 rounded-md animate-pulse">
                      <div className="w-2 h-2 rounded-full bg-rose-500" />
                      <span className="text-[10px] font-black text-rose-700 uppercase tracking-tighter">Edit Mode Engaged</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={handleCancelEdit}
                      className="px-3 py-1.5 bg-slate-200 text-slate-800 text-[10px] font-bold rounded-md hover:bg-slate-300 transition-colors shadow-sm"
                    >
                      Cancel
                    </button>
                    <button 
                      onClick={() => {
                          setIsEditMode(false);
                          setSelectedPoints([]);
                      }}
                      className="px-3 py-1.5 bg-slate-800 text-white text-[10px] font-bold rounded-md hover:bg-slate-700 transition-colors shadow-sm"
                    >
                      Finish Editing
                    </button>
                  </div>
              </div>
          )}
          <Button onClick={() => setShowDriveModal(true)} variant="secondary" className="text-xs h-9 px-4 text-emerald-700 border-emerald-200 hover:bg-emerald-50 bg-emerald-50/20">
            <Cloud size={14} className="text-emerald-600" /> Save to Google Drive
          </Button>
          <a
            href="/api/download-code-doc"
            download="NeuroGaze_Codebase_Line_By_Line_Explanation.docx"
            className="inline-flex items-center gap-1.5 text-xs h-9 px-3 rounded-xl font-bold bg-slate-900 hover:bg-slate-800 text-white transition-all shadow-sm"
            title="Download complete line-by-line codebase explanation Word document (.docx)"
          >
            <FileText size={14} className="text-blue-400" />
            <span>Code Doc (.docx)</span>
          </a>
          <Button onClick={handleDownload} variant="secondary" className="text-xs h-9 px-4">
            <Download size={14} /> Export Raw JSON
          </Button>
          <Button onClick={() => handleExportResearchLog('csv')} variant="secondary" className="text-xs h-9 px-4" title="Export the full adaptive-calibration research log (lighting, tracking quality, accepted/rejected samples, drift & micro-calibration events)">
            <Download size={14} /> Calibration Log (CSV)
          </Button>
          <Button onClick={() => fileInputRef.current?.click()} variant="secondary" className="text-xs h-9 px-4">
            <Upload size={14} /> Import Lab Data
          </Button>
          <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept=".json" className="hidden" />
          <Button onClick={() => setShowPdfModal(true)} variant="primary" className="text-xs h-9 px-4 bg-blue-600 hover:bg-blue-700">
            <FileText size={14} /> Export Clinical PDF
          </Button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar: Stimulus & Participant Info */}
        <aside className="w-80 bg-white border-r border-slate-200 overflow-y-auto hidden lg:flex flex-col p-6 space-y-8">
            <section>
                <h3 
                    onClick={toggleEditMode}
                    className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2 cursor-pointer select-none active:text-blue-500"
                >
                    <User size={14} /> Participant Metadata
                </h3>
                <div className="space-y-4">
                    <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
                        <div className="grid grid-cols-[auto_1fr] gap-x-8 gap-y-3 text-sm">
                            <span className="text-slate-900 font-medium">ID:</span>
                            <span className="font-bold text-right text-slate-800">{participant.id}</span>
                            <span className="text-slate-900 font-medium">Age:</span>
                            <span className="font-bold text-right text-slate-800">{participant.age} yrs</span>
                            <span className="text-slate-900 font-medium">Condition:</span>
                            <span className="font-bold text-right text-blue-700">{participant.condition}</span>
                            <span className="text-slate-900 font-medium">Calibration:</span>
                            <span className={`font-bold text-right ${
                                participant.calibrationQuality.includes('Excellent') ? 'text-emerald-700' : 
                                participant.calibrationQuality.includes('Good') ? 'text-blue-700' : 
                                participant.calibrationQuality.includes('Fair') ? 'text-amber-700' : 'text-red-700'
                             }`}>{participant.calibrationQuality}</span>
                        </div>
                        {(participant.calibrationQuality.includes('Poor') || participant.calibrationQuality.includes('Fair')) && (
                            <div className="mt-3 p-3 bg-amber-50 rounded-lg border border-amber-100 text-[10px] text-amber-700 leading-tight">
                                <div className="flex items-center gap-1 font-bold mb-1">
                                    <AlertTriangle size={10} /> Calibration Insight
                                </div>
                                Accuracy is lower than optimal. This often happens if "chasing" the calibration dot, moving the head, or due to uneven facial lighting.
                            </div>
                        )}
                    </div>
                </div>
            </section>

            <section>
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                    <BarChart3 size={14} /> Stimulus List
                </h3>
                <div className="space-y-2">
                    {data.map((d, idx) => (
                        <div 
                            key={idx}
                            className="group relative"
                        >
                            <button 
                                onClick={() => {
                                    setSelectedImageIndex(idx);
                                    setPlayTime(0);
                                    setIsPlaying(false);
                                }}
                                className={`w-full text-left px-4 py-3 rounded-xl border transition-all flex items-center gap-3 ${
                                    selectedImageIndex === idx 
                                    ? 'bg-blue-50 border-blue-200 text-blue-700 shadow-sm ring-1 ring-blue-100' 
                                    : 'bg-white border-slate-100 text-slate-600 hover:bg-slate-50'
                                }`}
                            >
                                <div className="w-8 h-8 rounded-lg bg-slate-200 overflow-hidden flex-shrink-0">
                                    <img src={d.imageUrl} className="w-full h-full object-cover" alt="" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="font-bold text-sm truncate">{d.imageId}</div>
                                    <div className="text-[10px] opacity-70">Duration: {((d.endTime - d.startTime)/1000).toFixed(1)}s</div>
                                </div>
                            </button>
                            
                            {/* Delete Button */}
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    handleDeleteResult(idx);
                                }}
                                className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                                title="Remove this result"
                            >
                                <Trash2 size={16} />
                            </button>
                        </div>
                    ))}
                </div>
            </section>

            <section className="pt-4 border-t border-slate-100">
                <div className="bg-amber-50 rounded-xl p-4 border border-amber-100">
                    <div className="flex items-center gap-2 text-amber-800 font-bold text-xs mb-1">
                        <AlertTriangle size={14} /> Clinical Note
                    </div>
                    <p className="text-[11px] text-amber-700 leading-relaxed">
                        Assess patterns for sustained fixation. Excessive scanning (hyper-saccades) may indicate anxiety or diagnostic visual search deficits.
                    </p>
                </div>
            </section>
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 overflow-y-auto bg-slate-50 p-4 md:p-8 space-y-6 md:space-y-8">
            
            <div className="grid grid-cols-1 gap-6 md:gap-8">
                {/* Visualizations Section */}
                <div className="space-y-6">
                    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                        <div className="px-4 py-3 md:px-6 md:py-4 border-b border-slate-100 flex flex-wrap justify-between items-center bg-slate-50/50 gap-4">
                            <div>
                                <h2 className="font-bold text-slate-800">Visual Analytics Suite</h2>
                                <p className="text-[10px] md:text-xs text-slate-500">Scanpath + Dynamic Gaze Replay</p>
                            </div>
                            <div className="flex items-center gap-3 md:gap-4">
                                <div className="flex items-center bg-white border border-slate-200 rounded-lg p-1 shadow-sm">
                                    <button 
                                        onClick={() => { setPlayTime(0); setIsPlaying(false); }}
                                        className="p-1.5 hover:bg-slate-100 rounded-md transition-colors"
                                    >
                                        <RotateCcw size={16} />
                                    </button>
                                    <button 
                                        onClick={() => setIsPlaying(!isPlaying)}
                                        className="p-1.5 hover:bg-slate-100 rounded-md transition-colors text-blue-600"
                                    >
                                        {isPlaying ? <Pause size={16} /> : <Play size={16} />}
                                    </button>
                                </div>
                                <div className="text-[11px] font-mono font-bold text-slate-400 bg-slate-100 px-2 py-1 rounded">
                                    {Math.round(playTime)}ms / {currentImg.endTime - currentImg.startTime}ms
                                </div>
                            </div>
                        </div>
                        
                        <div className="relative aspect-video bg-black flex items-center justify-center select-none"
                             onMouseMove={handleManualGazeMove}
                             onMouseUp={handleSelectionEnd}
                             onMouseLeave={handleSelectionEnd}
                             onMouseDown={(e) => {
                                 if (!isEditMode || !canvasRef.current) return;
                                 const rect = canvasRef.current.getBoundingClientRect();
                                 const x = (e.clientX - rect.left) / (rect.width / canvasRef.current.width);
                                 const y = (e.clientY - rect.top) / (rect.height / canvasRef.current.height);
                                 
                                 // Start selection box if not clicking a point
                                 setSelectionBox({ x1: x, y1: y, x2: x, y2: y });
                                 setSelectedPoints([]);
                             }}
                        >
                            <canvas 
                                ref={canvasRef}
                                width={800} height={450}
                                className="w-full h-full object-contain cursor-crosshair"
                            />

                            {/* Selection Box Visual */}
                            {isEditMode && selectionBox && (
                                <div 
                                    className="absolute border border-blue-400 bg-blue-400/20 pointer-events-none z-50"
                                    style={{
                                        left: `${(Math.min(selectionBox.x1, selectionBox.x2) / 800) * 100}%`,
                                        top: `${(Math.min(selectionBox.y1, selectionBox.y2) / 450) * 100}%`,
                                        width: `${(Math.abs(selectionBox.x2 - selectionBox.x1) / 800) * 100}%`,
                                        height: `${(Math.abs(selectionBox.y2 - selectionBox.y1) / 450) * 100}%`
                                    }}
                                />
                            )}
                            
                            {/* Draggable Gaze Handle Overlay in Edit Mode */}
                            {isEditMode && canvasRef.current && (
                                <div className="absolute inset-0 pointer-events-none">
                                    {(() => {
                                        const imgData = data[selectedImageIndex];
                                        const canvasWidth = canvasRef.current.width;
                                        const canvasHeight = canvasRef.current.height;
                                        const screenW = imgData.screenDimensions?.width || 1920;
                                        const screenH = imgData.screenDimensions?.height || 1080;
                                        const scaleX = canvasWidth / screenW;
                                        const scaleY = canvasHeight / screenH;

                                        return (
                                            <>
                                                {imgData.fixations.map((fix, idx) => {
                                                    const isSelected = selectedPoints.includes(idx);
                                                    return (
                                                        <div 
                                                            key={`fix-${idx}`}
                                                            onMouseDown={(e) => {
                                                                e.stopPropagation();
                                                                // If clicking an unselected point, select only it. 
                                                                // Otherwise, drag all selected points together.
                                                                let targets = selectedPoints;
                                                                if (!isSelected) {
                                                                    targets = [idx];
                                                                    setSelectedPoints([idx]);
                                                                }

                                                                const offsets = targets.map(tid => {
                                                                    const tfix = imgData.fixations[tid];
                                                                    return {
                                                                        idx: tid,
                                                                        dx: (tfix.x - fix.x) * scaleX,
                                                                        dy: (tfix.y - fix.y) * scaleY
                                                                    };
                                                                });

                                                                setDraggingPoint({ 
                                                                    fixIdx: idx, 
                                                                    startX: fix.x, 
                                                                    startY: fix.y,
                                                                    offsets
                                                                });
                                                            }}
                                                            style={{ 
                                                                left: `${(fix.x * scaleX / canvasWidth) * 100}%`,
                                                                top: `${(fix.y * scaleY / canvasHeight) * 100}%`,
                                                                transform: 'translate(-50%, -50%)'
                                                            }}
                                                            className={`absolute w-3 h-3 rounded-full border-2 border-white cursor-move pointer-events-auto transition-transform ${isSelected ? 'bg-yellow-400 scale-150 shadow-lg z-50' : 'bg-blue-500 hover:bg-yellow-400 z-10'}`}
                                                        />
                                                    );
                                                })}

                                                {(imgData.aois && imgData.aois.length > 0 ? imgData.aois : [{ center: { x: screenW / 2, y: screenH / 2 } }]).slice(0, 1).map((aoi, idx) => (
                                                    <div 
                                                        key={`aoi-${idx}`}
                                                        onMouseDown={(e) => {
                                                            e.stopPropagation();
                                                            setDraggingAoi({ aoiIdx: idx });
                                                        }}
                                                        style={{ 
                                                            left: `${(aoi.center.x * scaleX / canvasWidth) * 100}%`,
                                                            top: `${(aoi.center.y * scaleY / canvasHeight) * 100}%`,
                                                            transform: 'translate(-50%, -50%)'
                                                        }}
                                                        className={`absolute w-8 h-8 rounded-full border-2 border-emerald-400 bg-emerald-500/20 cursor-move pointer-events-auto flex items-center justify-center ${draggingAoi?.aoiIdx === idx ? 'scale-125 z-50 border-emerald-200' : 'z-20'}`}
                                                    >
                                                        <Target size={14} className="text-emerald-400" />
                                                    </div>
                                                ))}
                                            </>
                                        );
                                    })()}
                                </div>
                            )}
                            
                            {/* Replay Time Slider overlay */}
                            <div className="absolute bottom-4 left-6 right-6 flex items-center gap-4 bg-black/40 backdrop-blur-md px-4 py-2 rounded-xl border border-white/10 opacity-0 hover:opacity-100 transition-opacity duration-300">
                                <input 
                                    type="range"
                                    min={0}
                                    max={currentImg.endTime - currentImg.startTime}
                                    value={playTime}
                                    onChange={(e) => { setIsPlaying(false); setPlayTime(parseInt(e.target.value)); }}
                                    className="flex-1 accent-blue-500 h-1 rounded-lg"
                                />
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* AOI Analysis Table */}
                        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
                            <h3 className="text-sm font-bold text-slate-800 mb-4 flex items-center gap-2">
                                <Target size={16} className="text-blue-500" /> Area of Interest (AOI) Analysis
                            </h3>
                            <div className="overflow-hidden border border-slate-100 rounded-xl">
                                <table className="w-full text-sm">
                                    <thead className="bg-slate-50 text-slate-500 text-[10px] uppercase tracking-wider">
                                        <tr>
                                            <th className="px-4 py-3 text-left">AOI Label</th>
                                            <th className="px-4 py-3 text-center">Fixations</th>
                                            <th className="px-4 py-3 text-center">Dwell Time</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {aois.map((aoi, i) => (
                                            <tr key={i} className="hover:bg-slate-50 transition-colors">
                                                <td className="px-4 py-3 font-semibold text-slate-700">{aoi.name}</td>
                                                <td className="px-4 py-3 text-center text-slate-600">{aoi.fixationCount}</td>
                                                <td className="px-4 py-3 text-center text-slate-600">{aoi.dwellTime}ms</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        {/* Data Quality Metrics */}
                        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
                            <h3 className="text-sm font-bold text-slate-800 mb-4 flex items-center gap-2">
                                <ShieldCheck size={16} className="text-emerald-500" /> Data Integrity & Quality
                            </h3>
                            <div className="grid grid-cols-3 gap-4">
                                <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 text-center">
                                    <div className="text-[10px] text-slate-400 uppercase font-bold mb-1">Accuracy</div>
                                    <div className="text-lg font-bold text-slate-800">{quality.accuracy} px</div>
                                </div>
                                <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 text-center">
                                    <div className="text-[10px] text-slate-400 uppercase font-bold mb-1">Precision</div>
                                    <div className="text-lg font-bold text-slate-800">{quality.precision} px</div>
                                </div>
                                <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 text-center">
                                    <div className="text-[10px] text-slate-400 uppercase font-bold mb-1">Data Loss</div>
                                    <div className="text-lg font-bold text-emerald-600">{quality.dataLoss}%</div>
                                </div>
                            </div>
                            <p className="mt-4 text-[10px] text-slate-400 italic">
                                * Accuracy and precision are estimated based on calibration jitter and spatial dispersion during steady fixations.
                            </p>
                        </div>
                    </div>
                </div>

                {/* Metrics & Tables Section */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    {/* Comprehensive Parameters Grid */}
                    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 col-span-1 md:col-span-2">
                        <div className="flex items-center justify-between mb-8">
                            <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                                <Activity size={20} className="text-blue-600" /> Advanced Clinical Parameters
                            </h3>
                            <div className="flex gap-2">
                                <div className="bg-blue-50 text-blue-700 text-[10px] font-bold px-3 py-1 rounded-full uppercase tracking-wider border border-blue-100">Oculomotor</div>
                                <div className="bg-emerald-50 text-emerald-700 text-[10px] font-bold px-3 py-1 rounded-full uppercase tracking-wider border border-emerald-100">Neurological</div>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
                            {/* Oculomotor Metrics */}
                            <div className="space-y-4">
                                <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest border-b border-slate-100 pb-2">Oculomotor</h4>
                                <div className="space-y-3">
                                    <MetricRow label="Fixation Count" value={currentImg.metrics.fixationCount} />
                                    <MetricRow label="Avg Fixation Duration" value={`${(currentImg.metrics.avgFixationDuration || 0).toFixed(0)} ms`} />
                                    <MetricRow label="Total Dwell Time" value={`${(currentImg.metrics.totalDwellTime || 0).toFixed(0)} ms`} />
                                    <MetricRow label="Avg Saccade Velocity" value={`${(currentImg.metrics.avgSaccadeVelocity || 0).toFixed(2)} px/ms (~${Math.round((currentImg.metrics.avgSaccadeVelocity || 0) * 250)}°/s)`} />
                                    <MetricRow label="Saccade Count" value={currentImg.metrics.saccadeCount || 0} />
                                    <MetricRow label="Saccade Amplitude" value={`${(currentImg.metrics.saccadeAmplitude || 0).toFixed(1)} px`} />
                                </div>
                            </div>

                            {/* Blink & Pupil Analysis */}
                            <div className="space-y-4">
                                <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest border-b border-slate-100 pb-2">Blink & Pupil</h4>
                                    <div className="space-y-3">
                                        <MetricRow label="Blink Instability" value={(currentImg.metrics.blinkInstability || 0).toFixed(2)} />
                                        <MetricRow label="Est. Pupil Diameter" value={`${(currentImg.metrics.avgPupilDiameter || 0).toFixed(1)} mm`} />
                                        <MetricRow label="Pupil Activity" value={(currentImg.metrics.pupilActivity || 0).toFixed(2)} />
                                    <MetricRow label="Pupil Response Latency" value={`${Math.round(currentImg.metrics.pupilResponseLatency || 0)} ms`} />
                                </div>
                            </div>

                            {/* Attention & Fatigue */}
                            <div className="space-y-4">
                                <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest border-b border-slate-100 pb-2">Attention & Fatigue</h4>
                                <div className="space-y-3">
                                    <MetricRow label="Sustained Attention" value={`${(currentImg.metrics.sustainedAttentionScore || 0).toFixed(1)}%`} />
                                    <MetricRow label="Gaze Accuracy" value={`${(currentImg.metrics.accuracy || 0).toFixed(1)} px`} />
                                    <MetricRow label="Gaze Precision" value={`${(currentImg.metrics.precision || 0).toFixed(1)} px`} />
                                    <MetricRow label="BCEA Area" value={`${(currentImg.metrics.bcea || 0).toFixed(0)} px²`} />
                                </div>
                            </div>

                            {/* Neurological Indicators */}
                            <div className="space-y-4">
                                <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest border-b border-slate-100 pb-2">Neurological</h4>
                                <div className="space-y-3">
                                    <MetricRow label="VOR Proxy" value={(currentImg.metrics.vorGain || 0).toFixed(2)} />
                                    <MetricRow label="Vergence Index" value={(currentImg.metrics.vergenceIndex || 0).toFixed(2)} highlight={currentImg.metrics.vergenceIndex > 0} />
                                    <MetricRow label="Cytokinetic Index" value={(currentImg.metrics.cytokineticIndex || 0).toFixed(2)} />
                                    <MetricRow label="Gaze Drift" value={`${(currentImg.metrics.drift || 0).toFixed(2)} px/s`} />
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Fixation Latency Graph Card */}
                    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 flex flex-col h-full">
                        <div className="flex items-center justify-between mb-6">
                            <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                                <BarChart3 size={16} className="text-blue-500" /> Fixation Latency Graph
                            </h3>
                            <div className="bg-blue-50 text-blue-700 text-[10px] font-bold px-2 py-1 rounded uppercase tracking-wider">Statistical</div>
                        </div>
                        
                        <div className="flex-1 min-h-[200px]">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={currentImg.fixations.slice(0, 15)} margin={{ top: 10, right: 10, left: 10, bottom: 20 }}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                    <Bar dataKey="duration" fill="#f43f5e" radius={[4, 4, 0, 0]} />
                                    <XAxis 
                                        stroke="#94a3b8" 
                                        fontSize={10} 
                                        tickMargin={5}
                                        label={{ value: 'Fixation Order', position: 'insideBottom', offset: -10, fontSize: 10, fill: '#64748b' }}
                                    />
                                    <YAxis 
                                        fontSize={10} 
                                        stroke="#94a3b8"
                                        label={{ value: 'Duration (ms)', angle: -90, position: 'insideLeft', offset: 0, fontSize: 10, fill: '#64748b' }}
                                    />
                                    <Tooltip 
                                        contentStyle={{ fontSize: '10px', borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                        labelFormatter={(i) => `Fixation #${i+1}`} 
                                    />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                        <p className="mt-4 text-[10px] text-slate-400 italic">
                            Duration of the first 15 fixations in milliseconds. Longer bars indicate sustained attention periods.
                        </p>
                    </div>
                </div>
            </div>

            {/* Timeline & Velocity Graphs Row */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Gaze X/Y Timeline */}
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 h-[450px] flex flex-col">
                    <h3 className="text-sm font-bold text-slate-800 mb-6 flex items-center gap-2">
                        <Clock size={16} className="text-blue-500" /> Spatiotemporal Gaze Timeline
                    </h3>
                    <div className="flex-1">
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart 
                                data={currentImg.gazeLogs.filter((_, i) => i % 5 === 0).map(log => ({
                                    time: (((log.timestamp || 0) - (currentImg.startTime || 0)) / 1000).toFixed(2),
                                    xRel: ((log.x || 0) / (currentImg.screenDimensions?.width || 1)).toFixed(2),
                                    yRel: ((log.y || 0) / (currentImg.screenDimensions?.height || 1)).toFixed(2)
                                }))}
                                margin={{ top: 5, right: 30, left: 10, bottom: 20 }}
                            >
                                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                                <XAxis 
                                    dataKey="time" 
                                    stroke="#94a3b8" 
                                    fontSize={10} 
                                    tickMargin={10}
                                    label={{ value: 'Time (s)', position: 'insideBottom', offset: -10, fontSize: 10, fill: '#64748b' }}
                                />
                                <YAxis 
                                    stroke="#94a3b8" 
                                    fontSize={10} 
                                    domain={[0, 1]} 
                                    label={{ value: 'Pos (Rel)', angle: -90, position: 'insideLeft', offset: 15, fontSize: 10, fill: '#64748b' }}
                                />
                                <Tooltip 
                                    contentStyle={{ fontSize: '12px', borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                                />
                                <Legend verticalAlign="top" align="right" iconType="circle" wrapperStyle={{ fontSize: '10px', paddingBottom: '20px' }} />
                                <Line type="monotone" dataKey="xRel" name="Relative X" stroke="#ef4444" strokeWidth={2} dot={false} isAnimationActive={false} />
                                <Line type="monotone" dataKey="yRel" name="Relative Y" stroke="#3b82f6" strokeWidth={2} dot={false} isAnimationActive={false} />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Velocity vs Time */}
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 h-[450px] flex flex-col">
                    <h3 className="text-sm font-bold text-slate-800 mb-6 flex items-center gap-2">
                        <Activity size={16} className="text-emerald-500" /> Velocity-Time Spectrum
                    </h3>
                    <div className="flex-1">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={velocityData} margin={{ top: 5, right: 30, left: 10, bottom: 20 }}>
                                <defs>
                                    <linearGradient id="colorVel" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.1}/>
                                        <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                                <XAxis 
                                    dataKey="time" 
                                    stroke="#94a3b8" 
                                    fontSize={10} 
                                    tickMargin={10}
                                    label={{ value: 'Time (s)', position: 'insideBottom', offset: -10, fontSize: 10, fill: '#64748b' }}
                                />
                                <YAxis 
                                    stroke="#94a3b8" 
                                    fontSize={10}
                                    label={{ value: 'V (px/s)', angle: -90, position: 'insideLeft', offset: 0, fontSize: 10, fill: '#64748b' }}
                                />
                                <Tooltip 
                                    contentStyle={{ fontSize: '12px', borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                                />
                                <Area type="monotone" dataKey="velocity" name="Gaze Velocity" stroke="#10b981" strokeWidth={2} fillOpacity={1} fill="url(#colorVel)" isAnimationActive={false} />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                    <p className="mt-4 text-[10px] text-slate-400 italic">
                        Spikes in velocity indicate saccadic movements, while low-velocity plateaus represent fixational periods.
                    </p>
                </div>
            </div>

            {/* Oculomotor Gaze Classifier & Signal Detection Evaluation Section */}
            {(() => {
                const classMetrics = calculateGazeClassifierMetrics(
                    currentImg.gazeLogs,
                    currentImg.fixations,
                    aois,
                    currentImg.screenDimensions?.width || 1920,
                    currentImg.screenDimensions?.height || 1080,
                    currentImg.quality?.accuracy || 25
                );

                const formatPercent = (val: number) => `${val.toFixed(1)}%`;
                const totalPoints = classMetrics.tp + classMetrics.fp + classMetrics.fn + classMetrics.tn;
                const getPctOfTotal = (val: number) => formatPercent((val / (totalPoints || 1)) * 100);

                return (
                    <div id="gaze-classification-evaluation" className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 p-6 mt-8">
                        {/* Section Header */}
                        <div className="mb-6 pb-6 border-b border-slate-100 dark:border-slate-800">
                            <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                                <Grid3X3 size={18} className="text-emerald-600 dark:text-emerald-500" /> 
                                Oculomotor Classifier & Signal Detection Evaluation
                            </h3>
                            <p className="text-xs text-slate-500 mt-1 leading-normal">
                                Dynamic statistical performance evaluation for Patient <strong className="text-slate-700 dark:text-slate-300">{participant.id}</strong> based on gaze classifier predictions versus target Areas of Interest (AOIs).
                            </p>
                        </div>

                        {/* Metrics Cards Grid */}
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                            <div className="bg-gradient-to-br from-emerald-50 to-emerald-100/50 dark:from-emerald-950/20 dark:to-emerald-900/10 p-4 rounded-xl border border-emerald-100 dark:border-emerald-900/30">
                                <div className="text-[10px] text-emerald-800 dark:text-emerald-400 uppercase font-black tracking-wider flex items-center justify-between">
                                    <span>Accuracy</span>
                                    <Percent size={12} />
                                </div>
                                <div className="text-2xl md:text-3xl font-black text-emerald-900 dark:text-emerald-300 mt-1">
                                    {formatPercent(classMetrics.accuracy)}
                                </div>
                                <p className="text-[10px] text-emerald-700/80 dark:text-emerald-400/80 mt-1 leading-tight">
                                    Overall correct spatial attention classification rate.
                                </p>
                            </div>

                            <div className="bg-gradient-to-br from-blue-50 to-blue-100/50 dark:from-blue-950/20 dark:to-blue-900/10 p-4 rounded-xl border border-blue-100 dark:border-blue-900/30">
                                <div className="text-[10px] text-blue-800 dark:text-blue-400 uppercase font-black tracking-wider flex items-center justify-between">
                                    <span>Precision</span>
                                    <Percent size={12} />
                                </div>
                                <div className="text-2xl md:text-3xl font-black text-blue-900 dark:text-blue-300 mt-1">
                                    {formatPercent(classMetrics.precision)}
                                </div>
                                <p className="text-[10px] text-blue-700/80 dark:text-blue-400/80 mt-1 leading-tight">
                                    Proportion of classified target hits representing true fixations.
                                </p>
                            </div>

                            <div className="bg-gradient-to-br from-indigo-50 to-indigo-100/50 dark:from-indigo-950/20 dark:to-indigo-900/10 p-4 rounded-xl border border-indigo-100 dark:border-indigo-900/30">
                                <div className="text-[10px] text-indigo-800 dark:text-indigo-400 uppercase font-black tracking-wider flex items-center justify-between">
                                    <span>F-Score (F1)</span>
                                    <Percent size={12} />
                                </div>
                                <div className="text-2xl md:text-3xl font-black text-indigo-900 dark:text-indigo-300 mt-1">
                                    {formatPercent(classMetrics.fScore)}
                                </div>
                                <p className="text-[10px] text-indigo-700/80 dark:text-indigo-400/80 mt-1 leading-tight">
                                    Harmonic mean balancing precision and sensory recall.
                                </p>
                            </div>

                            <div className="bg-gradient-to-br from-purple-50 to-purple-100/50 dark:from-purple-950/20 dark:to-purple-900/10 p-4 rounded-xl border border-purple-100 dark:border-purple-900/30">
                                <div className="text-[10px] text-purple-800 dark:text-purple-400 uppercase font-black tracking-wider flex items-center justify-between">
                                    <span>Recall / Sensitivity</span>
                                    <Percent size={12} />
                                </div>
                                <div className="text-2xl md:text-3xl font-black text-purple-900 dark:text-purple-300 mt-1">
                                    {formatPercent(classMetrics.recall)}
                                </div>
                                <p className="text-[10px] text-purple-700/80 dark:text-purple-400/80 mt-1 leading-tight">
                                    Proportion of actual target glances correctly detected.
                                </p>
                            </div>
                        </div>

                        {/* Confusion Matrix Section */}
                        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                            {/* Visual 2x2 Matrix Grid */}
                            <div className="lg:col-span-7 space-y-4">
                                <h4 className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">
                                    Signal Detection Confusion Matrix (2x2)
                                </h4>
                                
                                <div className="border border-slate-100 dark:border-slate-800 rounded-2xl p-4 bg-slate-50/50 dark:bg-slate-900/30 overflow-x-auto">
                                    <div className="min-w-[450px]">
                                        {/* Matrix Column Headers */}
                                        <div className="grid grid-cols-[140px_1fr_1fr] gap-3 text-center mb-2">
                                            <div />
                                            <div className="text-[10px] font-black text-slate-400 uppercase tracking-wider">
                                                Actual Target Focus (+)
                                            </div>
                                            <div className="text-[10px] font-black text-slate-400 uppercase tracking-wider">
                                                Actual Background Focus (-)
                                            </div>
                                        </div>

                                        {/* Matrix Row 1: Predicted Positive */}
                                        <div className="grid grid-cols-[140px_1fr_1fr] gap-3 mb-3 items-center">
                                            <div className="text-[10px] font-black text-slate-400 uppercase text-right pr-2 leading-tight">
                                                Predicted AOI Gaze (+)
                                            </div>
                                            {/* TP */}
                                            <div className="bg-emerald-50 dark:bg-emerald-950/20 border-2 border-emerald-500/30 hover:border-emerald-500 rounded-xl p-4 text-center transition-all">
                                                <div className="text-[10px] font-bold text-emerald-800 dark:text-emerald-400 uppercase tracking-wider">
                                                    True Positive (TP)
                                                </div>
                                                <div className="text-xl font-bold text-emerald-900 dark:text-emerald-300 mt-1">
                                                    {classMetrics.tp}
                                                </div>
                                                <div className="text-[10px] text-emerald-700/70 dark:text-emerald-400/70 mt-0.5">
                                                    {getPctOfTotal(classMetrics.tp)} of logs
                                                </div>
                                            </div>
                                            {/* FP */}
                                            <div className="bg-rose-50 dark:bg-rose-950/20 border-2 border-rose-500/20 hover:border-rose-500 rounded-xl p-4 text-center transition-all">
                                                <div className="text-[10px] font-bold text-rose-800 dark:text-rose-400 uppercase tracking-wider">
                                                    False Positive (FP)
                                                </div>
                                                <div className="text-xl font-bold text-rose-900 dark:text-rose-300 mt-1">
                                                    {classMetrics.fp}
                                                </div>
                                                <div className="text-[10px] text-rose-700/70 dark:text-rose-400/70 mt-0.5">
                                                    {getPctOfTotal(classMetrics.fp)} of logs
                                                </div>
                                            </div>
                                        </div>

                                        {/* Matrix Row 2: Predicted Negative */}
                                        <div className="grid grid-cols-[140px_1fr_1fr] gap-3 items-center">
                                            <div className="text-[10px] font-black text-slate-400 uppercase text-right pr-2 leading-tight">
                                                Predicted Background (-)
                                            </div>
                                            {/* FN */}
                                            <div className="bg-amber-50 dark:bg-amber-950/20 border-2 border-amber-500/20 hover:border-amber-500 rounded-xl p-4 text-center transition-all">
                                                <div className="text-[10px] font-bold text-amber-800 dark:text-amber-400 uppercase tracking-wider">
                                                    False Negative (FN)
                                                </div>
                                                <div className="text-xl font-bold text-amber-900 dark:text-amber-300 mt-1">
                                                    {classMetrics.fn}
                                                </div>
                                                <div className="text-[10px] text-amber-700/70 dark:text-amber-400/70 mt-0.5">
                                                    {getPctOfTotal(classMetrics.fn)} of logs
                                                </div>
                                            </div>
                                            {/* TN */}
                                            <div className="bg-slate-100 dark:bg-slate-800/40 border-2 border-slate-300/30 hover:border-slate-400 rounded-xl p-4 text-center transition-all">
                                                <div className="text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
                                                    True Negative (TN)
                                                </div>
                                                <div className="text-xl font-bold text-slate-800 dark:text-slate-300 mt-1">
                                                    {classMetrics.tn}
                                                </div>
                                                <div className="text-[10px] text-slate-500 mt-0.5">
                                                    {getPctOfTotal(classMetrics.tn)} of logs
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Statistical Guidance & Diagnostics */}
                            <div className="lg:col-span-5 space-y-4">
                                <h4 className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">
                                    Clinical Validation Guide
                                </h4>
                                <div className="space-y-3 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                                    <div className="bg-slate-50 dark:bg-slate-800/30 rounded-xl p-4 border border-slate-100 dark:border-slate-800/60">
                                        <p className="font-bold text-slate-800 dark:text-slate-200 mb-1 flex items-center gap-1.5">
                                            <span className="w-2 h-2 rounded-full bg-emerald-500" />
                                            True Positives (TP) vs False Negatives (FN)
                                        </p>
                                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                            A high count of <strong>True Positives</strong> confirms excellent eye-tracking target alignment. If <strong>False Negatives</strong> are elevated, it indicates that calibration has drifted, or that the participant is fixating near but slightly outside the designated AOI coordinates.
                                        </p>
                                    </div>

                                    <div className="bg-slate-50 dark:bg-slate-800/30 rounded-xl p-4 border border-slate-100 dark:border-slate-800/60">
                                        <p className="font-bold text-slate-800 dark:text-slate-200 mb-1 flex items-center gap-1.5">
                                            <span className="w-2 h-2 rounded-full bg-rose-500" />
                                            False Positives (FP) & Transit Noise
                                        </p>
                                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                            <strong>False Positives</strong> represent transitional eye movements (like saccades passing through an AOI target) or spatial tracking jitter. A low FP rate is indicative of a robust fixation filter that cleanly filters out passive saccadic sweeps.
                                        </p>
                                    </div>

                                    <p className="text-[10px] text-slate-400 italic">
                                        * Evaluated across {totalPoints} total raw gaze events captured during this stimulus block.
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                );
            })()}

            {/* Scientific Peer-Reviewed Benchmark Directory */}
            <BenchmarkTable 
                metrics={currentImg.metrics} 
                durationMs={currentImg.endTime - currentImg.startTime} 
                patientId={participant.id} 
            />
        </main>
      </div>

      {/* Reused Modal & PDF logic remains below */}
      {/* Hidden container for PDF export */}
      <div style={{ position: 'absolute', left: '-9999px', top: 0 }}>
        {data.map((d, i) => (
          <div key={i}>
            <TimelineChart id={`timeline-chart-${i}`} imgData={d} />
            <VelocitySpectrumChart id={`velocity-chart-${i}`} imgData={d} />
            <FixationLatencyChart id={`latency-chart-${i}`} imgData={d} />
          </div>
        ))}
      </div>

      {/* PDF Download Modal */}
      {showPdfModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-8 transform transition-all animate-in fade-in zoom-in duration-200">
            <div className="flex items-center gap-3 mb-6">
              <div className="bg-blue-100 p-2 rounded-lg">
                <FileText className="text-blue-600 w-6 h-6" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-slate-900">Export PDF Report</h2>
                <p className="text-slate-500 text-sm">Choose report scope</p>
              </div>
            </div>
            
            <div className="space-y-3 mb-8">
              <button 
                onClick={() => handleDownloadPDF(false)}
                className="w-full flex items-center justify-between p-4 rounded-xl border border-slate-200 hover:border-blue-500 hover:bg-blue-50 transition-all text-left"
              >
                <div>
                  <div className="font-bold text-slate-800">Current Image</div>
                  <div className="text-xs text-slate-500">Only data for image #{selectedImageIndex + 1}</div>
                </div>
                <div className="w-2 h-2 rounded-full bg-slate-300"></div>
              </button>
              
              <button 
                onClick={() => handleDownloadPDF(true)}
                className="w-full flex items-center justify-between p-4 rounded-xl border border-slate-200 hover:border-blue-500 hover:bg-blue-50 transition-all text-left"
              >
                <div>
                  <div className="font-bold text-slate-800">All Images</div>
                  <div className="text-xs text-slate-500">Comprehensive report for all {data.length} stimuli</div>
                </div>
                <div className="w-2 h-2 rounded-full bg-slate-300"></div>
              </button>
            </div>
            
            <div className="flex justify-end">
              <Button onClick={() => setShowPdfModal(false)} variant="secondary">Cancel</Button>
            </div>
          </div>
        </div>
      )}

      {/* Google Drive Upload Modal */}
      {showDriveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full p-6 md:p-8 transform transition-all animate-in fade-in zoom-in duration-200 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="bg-emerald-100 p-2.5 rounded-xl">
                  <Cloud className="text-emerald-600 w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-slate-900">Google Drive Synchronization</h2>
                  <p className="text-slate-500 text-xs">Automatically save exported JSON data to your shared clinical folder</p>
                </div>
              </div>
              <button 
                onClick={() => {
                  setShowDriveModal(false);
                  setDriveResult(null);
                  setDriveError(null);
                }} 
                className="text-slate-400 hover:text-slate-600 font-bold p-1 hover:bg-slate-50 rounded-lg text-lg line-none focus:outline-none"
              >
                ✕
              </button>
            </div>

            <div className="space-y-5">
              <div className="bg-emerald-50/50 p-5 rounded-2xl border border-emerald-100/60 leading-relaxed text-xs text-slate-600">
                <p className="mb-2 font-semibold text-slate-800 text-sm">Secure Cloud Storage Sandbox</p>
                <p className="mb-3">
                  This portal securely syncs finished study results directly to your designated collaborative Google Drive clinical repository. 
                </p>
                <p className="text-slate-500 font-medium">
                  🔒 <strong className="font-semibold text-slate-600">Enhanced Privacy:</strong> In compliance with security standards, all destination parameters (including Folder IDs and Apps Script Gateway Addresses) are fully encapsulated inside the server-side environment and are never transmitted or exposed to the public browser client.
                </p>
              </div>

              {/* Success Result Container */}
              {driveResult && (
                <div className="bg-emerald-50 border border-emerald-200 p-5 rounded-2xl space-y-3 animate-in zoom-in-95 duration-200">
                  <div className="flex items-center gap-2 text-emerald-800 font-bold text-sm">
                    <Check className="p-1 bg-emerald-600 text-white rounded-full" size={20} />
                    Export Successfully Saved!
                  </div>
                  <div className="text-xs text-emerald-700 leading-relaxed font-medium">
                    The raw JSON export package has been successfully sent, authenticated, and saved directly to the shared clinical folder on Google Drive.
                  </div>
                  <div className="bg-white/80 p-3.5 rounded-xl text-xs font-mono space-y-1.5 border border-emerald-100/30">
                    <div className="flex justify-between items-center gap-4"><span className="text-slate-400">File ID:</span> <span className="text-slate-700 select-all truncate font-semibold">{driveResult.id}</span></div>
                    <div className="flex justify-between items-center gap-4"><span className="text-slate-400">File Name:</span> <span className="text-slate-700 font-bold truncate">{driveResult.name}</span></div>
                  </div>
                  <div className="pt-2 flex justify-end">
                    <a
                      href={driveResult.url}
                      target="_blank"
                      rel="noreferrer"
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 transition-colors text-white font-bold text-xs rounded-xl shadow-md inline-flex items-center gap-2"
                    >
                      View File in Google Drive ↗
                    </a>
                  </div>
                </div>
              )}

              {/* Error Logging Container */}
              {driveError && (
                <div className="bg-rose-50 border border-rose-200 p-4 rounded-xl space-y-2 animate-in zoom-in-95 duration-200">
                  <div className="flex items-center gap-2 text-rose-800 font-bold text-xs">
                    <AlertTriangle className="text-rose-600" size={16} /> Save Encountered an Issue
                  </div>
                  <p className="text-[11px] text-rose-700 leading-normal bg-white/70 p-3 rounded-lg border border-rose-100/40 select-all font-mono">
                    {driveError}
                  </p>
                  <p className="text-[10px] text-slate-500">
                    💡 <strong className="font-semibold">Troubleshooting:</strong> Standard causes include: The developer has not specified <code className="font-mono bg-slate-100 px-1 rounded text-slate-700">GAS_WEB_APP_URL</code> inside the server configuration, or the target Apps Script has expired or lacks correct write credentials.
                  </p>
                </div>
              )}

              {/* Main Submit Button */}
              <div className="pt-4 border-t border-slate-200 flex justify-end gap-3">
                <Button 
                  onClick={() => {
                    setShowDriveModal(false);
                    setDriveResult(null);
                    setDriveError(null);
                  }} 
                  variant={driveResult ? "primary" : "secondary"}
                  className={`rounded-xl px-5 text-xs ${driveResult ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-200 w-full justify-center py-2.5' : 'text-slate-600'}`}
                >
                  Close & Done
                </Button>
                {!driveResult && (
                  <button
                    disabled={isSavingToDrive}
                    onClick={handleSaveToGoogleDrive}
                    className={`px-5 py-2.5 rounded-xl font-bold text-xs shadow-md transition-all flex items-center justify-center gap-2 ${
                      isSavingToDrive
                        ? 'bg-slate-100 text-slate-400 cursor-not-allowed border'
                        : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-200 hover:scale-[1.01]'
                    }`}
                  >
                    {isSavingToDrive ? (
                      <>
                        <Loader2 size={16} className="animate-spin text-white" /> Saving JSON Payload...
                      </>
                    ) : (
                      <>
                        <Cloud size={16} /> Save Study to Drive
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <Modal
          isOpen={modalConfig.isOpen}
          onClose={() => setModalConfig(prev => ({ ...prev, isOpen: false }))}
          title={modalConfig.title}
          message={modalConfig.message}
          type={modalConfig.type}
          onConfirm={modalConfig.onConfirm}
        />
    </div>
  );
};

export default Results;