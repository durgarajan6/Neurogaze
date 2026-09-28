import React from 'react';
import { CheckCircle, XCircle, Sun, Activity, Gauge, RefreshCw } from 'lucide-react';
import { TrackingQualityResult, AdaptiveStatus, ADAPTIVE_STATUS_LABELS } from '../utils/adaptiveEngine';
import { LightingReading } from '../utils/lighting';

interface CalibrationDashboardProps {
  pointsDone: number;
  totalPoints: number;
  trackingQuality: TrackingQualityResult;
  lightingReading: LightingReading | null;
  sampleStats: { accepted: number; rejected: number };
  adaptiveStatus: AdaptiveStatus;
  currentErrorPx: number | null;
  validationScore: number | null;
  compact?: boolean;
}

const StatusDot: React.FC<{ ok: boolean; label: string }> = ({ ok, label }) => (
  <div className="flex items-center gap-1.5 text-[11px]">
    {ok ? <CheckCircle size={13} className="text-emerald-400 shrink-0" /> : <XCircle size={13} className="text-red-400 shrink-0" />}
    <span className={ok ? 'text-slate-300' : 'text-slate-500'}>{label}</span>
  </div>
);

const lightingLabel: Record<string, string> = {
  normal: 'Normal',
  low: 'Low',
  bright: 'Bright',
  unstable: 'Unstable',
  unknown: 'Detecting…',
};

const statusColor: Record<AdaptiveStatus, string> = {
  initial_calibration: 'text-blue-300 border-blue-500/40 bg-blue-950/30',
  validating: 'text-indigo-300 border-indigo-500/40 bg-indigo-950/30',
  monitoring: 'text-emerald-300 border-emerald-500/40 bg-emerald-950/30',
  drift_detected: 'text-yellow-300 border-yellow-500/40 bg-yellow-950/30',
  collecting_samples: 'text-sky-300 border-sky-500/40 bg-sky-950/30',
  updating_model: 'text-purple-300 border-purple-500/40 bg-purple-950/30',
  adaptation_complete: 'text-emerald-300 border-emerald-500/40 bg-emerald-950/30',
  insufficient_data: 'text-slate-400 border-slate-600/40 bg-slate-800/30',
};

export const CalibrationDashboard: React.FC<CalibrationDashboardProps> = ({
  pointsDone, totalPoints, trackingQuality, lightingReading, sampleStats, adaptiveStatus,
  currentErrorPx, validationScore, compact,
}) => {
  const qualityColor = trackingQuality.score >= 75 ? 'text-emerald-400' : trackingQuality.score >= 50 ? 'text-yellow-400' : 'text-red-400';

  return (
    <div className={`bg-slate-900/90 backdrop-blur border border-slate-700 rounded-xl shadow-xl text-white ${compact ? 'p-3 text-xs' : 'p-4 text-sm'} w-full max-w-xs space-y-3`}>
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Calibration Progress</span>
        <span className="font-mono text-xs text-slate-200">{pointsDone}/{totalPoints}</span>
      </div>
      <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
        <div className="h-full bg-blue-500 transition-all duration-300" style={{ width: `${(pointsDone / totalPoints) * 100}%` }} />
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1"><Gauge size={11} /> Tracking Quality</span>
          <span className={`font-mono font-bold ${qualityColor}`}>{trackingQuality.score}%</span>
        </div>
        <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
          <StatusDot ok={trackingQuality.status.faceDetected} label="Face detected" />
          <StatusDot ok={trackingQuality.status.eyesDetected} label="Eyes detected" />
          <StatusDot ok={trackingQuality.status.gazeValid} label="Gaze valid" />
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1"><Sun size={11} /> Environment</span>
          <span className={`font-mono text-xs ${lightingReading?.qualityOk ? 'text-emerald-400' : 'text-yellow-400'}`}>
            {lightingReading ? lightingLabel[lightingReading.condition] : 'Detecting…'}
          </span>
        </div>
        {lightingReading && (
          <div className="text-[10px] text-slate-400 font-mono">Brightness: {Math.round(lightingReading.brightness)}/255</div>
        )}
      </div>

      <div>
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1 mb-1"><Activity size={11} /> Adaptive Engine</span>
        <div className={`text-[11px] font-semibold px-2 py-1 rounded-lg border inline-flex items-center gap-1.5 ${statusColor[adaptiveStatus]}`}>
          {adaptiveStatus === 'drift_detected' && <RefreshCw size={11} className="animate-spin" />}
          {ADAPTIVE_STATUS_LABELS[adaptiveStatus]}
        </div>
      </div>

      {(currentErrorPx !== null || validationScore !== null) && (
        <div className="pt-2 border-t border-slate-800 flex justify-between text-[11px]">
          {currentErrorPx !== null && (
            <div>
              <div className="text-slate-400 uppercase text-[9px] tracking-wide">Gaze Error</div>
              <div className="font-mono font-bold text-slate-100">{Math.round(currentErrorPx)}px</div>
            </div>
          )}
          {validationScore !== null && (
            <div className="text-right">
              <div className="text-slate-400 uppercase text-[9px] tracking-wide">Validation</div>
              <div className="font-mono font-bold text-slate-100">{validationScore}%</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default CalibrationDashboard;
