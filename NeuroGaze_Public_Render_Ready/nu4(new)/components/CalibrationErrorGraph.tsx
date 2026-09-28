import React, { useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine } from 'recharts';

export interface ErrorGraphPoint {
  index: number;
  error: number;
  phase: 'initial' | 'recalibration' | 'validation' | 'adaptation';
  label?: string;
}

interface CalibrationErrorGraphProps {
  points: ErrorGraphPoint[];
  height?: number;
}

const PHASE_COLORS: Record<ErrorGraphPoint['phase'], string> = {
  initial: '#38bdf8',      // sky-400
  recalibration: '#fb923c', // orange-400
  validation: '#a78bfa',   // violet-400
  adaptation: '#34d399',   // emerald-400
};

/**
 * Renders one continuous line (so trend is visible) but colours each point
 * by phase via a custom dot, plus a legend so reviewers can see where
 * "initial calibration", "validation" and "adaptation" measurements sit.
 * All points come from actual recorded measurements passed in by the
 * caller - this component performs no calculation of its own.
 */
export const CalibrationErrorGraph: React.FC<CalibrationErrorGraphProps> = ({ points, height = 220 }) => {
  const data = useMemo(() => points.map((p, i) => ({ ...p, i })), [points]);

  if (points.length === 0) {
    return (
      <div className="flex items-center justify-center text-xs text-slate-500 border border-dashed border-slate-700 rounded-lg" style={{ height }}>
        No error measurements recorded yet
      </div>
    );
  }

  const CustomDot = (props: any) => {
    const { cx, cy, payload } = props;
    if (cx == null || cy == null) return null;
    return <circle cx={cx} cy={cy} r={3.5} fill={PHASE_COLORS[payload.phase as ErrorGraphPoint['phase']]} stroke="#0f172a" strokeWidth={1} />;
  };

  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis dataKey="i" stroke="#94a3b8" tick={{ fontSize: 10 }} label={{ value: 'Sample #', position: 'insideBottom', offset: -2, fontSize: 10, fill: '#94a3b8' }} />
          <YAxis stroke="#94a3b8" tick={{ fontSize: 10 }} label={{ value: 'Error (px)', angle: -90, position: 'insideLeft', fontSize: 10, fill: '#94a3b8' }} />
          <Tooltip
            contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, fontSize: 11 }}
            labelFormatter={() => ''}
            formatter={(value: any, _name: any, props: any) => [`${Math.round(value)}px`, props.payload.phase]}
          />
          <Legend
            payload={[
              { value: 'Initial calibration', type: 'circle', color: PHASE_COLORS.initial },
              { value: 'Validation', type: 'circle', color: PHASE_COLORS.validation },
              { value: 'Adaptation', type: 'circle', color: PHASE_COLORS.adaptation },
            ]}
            wrapperStyle={{ fontSize: 10 }}
          />
          <Line type="monotone" dataKey="error" stroke="#64748b" strokeWidth={1.5} dot={<CustomDot />} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

export default CalibrationErrorGraph;
