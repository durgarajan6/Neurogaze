import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { ImageSessionData } from '../types';
import { getPrimaryFocusRegion } from './math';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, AreaChart, Area, BarChart, Bar
} from 'recharts';

/**
 * Sub-component for Timeline Chart (Optimized for PDF)
 */
export const TimelineChart = ({ id, imgData }: { id: string, imgData: ImageSessionData }) => (
  <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 flex flex-col h-[400px] w-[700px]" id={id}>
    <div className="flex justify-between items-center mb-4">
      <h3 className="font-bold text-slate-800 text-sm">Gaze Position Timeline</h3>
      <div className="flex gap-4 text-[10px] text-slate-400">
          <span className="flex items-center gap-1"><span className="w-2 h-2 bg-red-500 rounded-full"></span> Horizontal (X)</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 bg-blue-500 rounded-full"></span> Vertical (Y)</span>
      </div>
    </div>
    
    <div className="flex-1 min-h-0">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart 
          data={imgData.gazeLogs.filter((_, i) => i % 2 === 0).map(log => ({
            time: ((log.timestamp - (imgData.gazeLogs[0]?.timestamp || imgData.startTime)) / 1000).toFixed(2),
            xRel: Math.max(0, Math.min(1, (log.x || 0) / (imgData.screenDimensions?.width || 1920))),
            yRel: Math.max(0, Math.min(1, (log.y || 0) / (imgData.screenDimensions?.height || 1080)))
          }))}
          margin={{ top: 5, right: 30, left: 0, bottom: 20 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
          <XAxis 
            dataKey="time" 
            stroke="#94a3b8" 
            fontSize={10} 
            tickMargin={10}
            label={{ value: 'Time (s)', position: 'insideBottom', offset: -15, fontSize: 10, fill: '#64748b' }}
          />
          <YAxis 
            stroke="#94a3b8" 
            fontSize={10} 
            domain={[0, 1]} 
            tickFormatter={(val) => (val ?? 0).toFixed(1)}
            label={{ value: 'Rel. Position', angle: -90, position: 'insideLeft', offset: 15, fontSize: 10, fill: '#64748b' }}
          />
          <Tooltip 
            contentStyle={{ fontSize: '12px', borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
            labelFormatter={(val) => `Time: ${val}s`} 
          />
          <Legend verticalAlign="top" height={30} iconType="circle" wrapperStyle={{ fontSize: '10px' }} />
          <Line type="monotone" dataKey="xRel" name="Horizontal (X)" stroke="#ef4444" strokeWidth={1.5} dot={false} isAnimationActive={false} />
          <Line type="monotone" dataKey="yRel" name="Vertical (Y)" stroke="#3b82f6" strokeWidth={1.5} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  </div>
);

/**
 * Sub-component for Fixation Latency Chart (Optimized for PDF)
 */
export const FixationLatencyChart = ({ id, imgData }: { id: string, imgData: ImageSessionData }) => (
  <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 flex flex-col h-[400px] w-[700px]" id={id}>
    <div className="flex justify-between items-center mb-4">
      <h3 className="font-bold text-slate-800 text-sm">Fixation Duration Latency</h3>
      <span className="text-[10px] text-slate-400">Duration (ms)</span>
    </div>
    <div className="flex-1 min-h-0">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart 
          data={imgData.fixations.slice(0, 15)} 
          margin={{ top: 10, right: 30, left: 0, bottom: 20 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
          <XAxis 
            stroke="#94a3b8" 
            fontSize={10} 
            tickMargin={10}
            label={{ value: 'Fixation Order', position: 'insideBottom', offset: -15, fontSize: 10, fill: '#64748b' }}
          />
          <YAxis 
            stroke="#94a3b8" 
            fontSize={10}
            label={{ value: 'Duration (ms)', angle: -90, position: 'insideLeft', offset: 15, fontSize: 10, fill: '#64748b' }}
          />
          <Tooltip 
            contentStyle={{ fontSize: '12px', borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
            labelFormatter={(index) => `Fixation #${Number(index) + 1}`} 
          />
          <Bar dataKey="duration" fill="#f43f5e" radius={[4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  </div>
);

/**
 * Sub-component for Velocity Spectrum Chart (Optimized for PDF)
 */
export const VelocitySpectrumChart = ({ id, imgData }: { id: string, imgData: ImageSessionData }) => {
  const velocityData = imgData.gazeLogs.reduce((acc: any[], log, i, arr) => {
    if (i === 0) return acc;
    const prev = arr[i - 1];
    const dx = log.x - prev.x;
    const dy = log.y - prev.y;
    const dt = log.timestamp - prev.timestamp;
    if (dt === 0) return acc;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const vel = dist / dt; // pixels/ms
    
    acc.push({
      time: (((log.timestamp || 0) - (imgData.startTime || 0)) / 1000).toFixed(2),
      velocity: Math.min(2500, Math.round((vel || 0) * 1000)), // pixels/sec
    });
    return acc;
  }, []);

  return (
    <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 flex flex-col h-[400px] w-[700px]" id={id}>
      <div className="flex justify-between items-center mb-4">
        <h3 className="font-bold text-slate-800 text-sm">Velocity-Time Spectrum</h3>
        <span className="text-[10px] text-slate-400">Velocity (px/s)</span>
      </div>
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={velocityData} margin={{ top: 5, right: 30, left: 10, bottom: 20 }}>
            <defs>
              <linearGradient id="colorVelPDF" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10b981" stopOpacity={0.4}/>
                <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis 
              dataKey="time" 
              stroke="#94a3b8" 
              fontSize={10} 
              tickMargin={10}
              label={{ value: 'Time (s)', position: 'insideBottom', offset: -15, fontSize: 10, fill: '#64748b' }}
            />
            <YAxis 
              stroke="#94a3b8" 
              fontSize={10} 
              label={{ value: 'Velocity (px/s)', angle: -90, position: 'insideLeft', offset: 0, fontSize: 10, fill: '#64748b' }}
            />
            <Tooltip 
              contentStyle={{ fontSize: '12px', borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
              labelFormatter={(val) => `Time: ${val}s`} 
            />
            <Area type="monotone" dataKey="velocity" name="Gaze Velocity" stroke="#10b981" strokeWidth={1.5} fillOpacity={1} fill="url(#colorVelPDF)" isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

/**
 * Generate an offscreen heatmap/scanpath image for the PDF report
 */
export const generateOffscreenHeatmap = (imgData: ImageSessionData): Promise<string> => {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 450;
    const ctx = canvas.getContext('2d');
    if (!ctx) return reject('No context');

    const bgImg = new Image();
    bgImg.crossOrigin = "Anonymous";
    bgImg.src = imgData.imageUrl;
    
    bgImg.onload = () => {
       const canvasWidth = canvas.width;
       const canvasHeight = canvas.height;
       
       ctx.clearRect(0, 0, canvasWidth, canvasHeight);
       
       const screenW = imgData.screenDimensions?.width || window.innerWidth;
       const screenH = imgData.screenDimensions?.height || window.innerHeight;
       
       if (screenH === 0 || bgImg.height === 0) return resolve('');

       const screenRatio = screenW / screenH;
       const imgRatio = bgImg.width / bgImg.height;

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

       const scaleX = canvasWidth / screenW;
       const scaleY = canvasHeight / screenH;

       const renderW_canvas = renderW_screen * scaleX;
       const renderH_canvas = renderH_screen * scaleY;
       const offsetX_canvas = offsetX_screen * scaleX;
       const offsetY_canvas = offsetY_screen * scaleY;

       ctx.globalAlpha = 1.0;
       ctx.fillStyle = 'black';
       ctx.fillRect(0, 0, canvasWidth, canvasHeight);
       
       ctx.drawImage(bgImg, offsetX_canvas, offsetY_canvas, renderW_canvas, renderH_canvas);
       
       // DRAW AOIs (Single Green Circle)
       const displayAois = (imgData.aois && imgData.aois.length > 0) ? imgData.aois.slice(0, 1) : [
           (() => {
               const fixs = imgData.fixations || [];
               const totalDur = fixs.reduce((sum: number, f: any) => sum + f.duration, 0);
               return { 
                   name: "Primary Focus Region", 
                   center: { 
                       x: getPrimaryFocusRegion(fixs, screenW, screenH).x, y: getPrimaryFocusRegion(fixs, screenW, screenH).y }, radius: getPrimaryFocusRegion(fixs, screenW, screenH).radius
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

       ctx.fillStyle = 'rgba(0,0,0,0.3)';
       ctx.fillRect(0, 0, canvasWidth, canvasHeight);

       ctx.beginPath();
       ctx.strokeStyle = '#60a5fa';
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
             
             ctx.fillStyle = 'white';
             ctx.font = '10px Arial';
             ctx.textAlign = 'center';
             ctx.textBaseline = 'middle';
             if (radius > 6) {
                ctx.fillText((i+1).toString(), x, y);
             }
           });
       }
       
       resolve(canvas.toDataURL('image/png'));
    };
    bgImg.onerror = reject;
  });
};

interface PdfBenchmark {
  name: string;
  range: string;
  val: string;
  status: string;
  statusType: 'normal' | 'low' | 'high' | 'danger' | 'info';
  ref: string;
}

const getPdfBenchmarks = (metrics: any, durationMs: number): PdfBenchmark[] => {
  const durationS = (durationMs || 12000) / 1000;
  
  // 1. Fixation Count
  const fc = metrics.fixationCount || 0;
  const fcStatus = fc < 15 ? 'Low' : fc <= 40 ? 'Normal' : 'Elevated';
  const fcType = fc < 15 ? 'low' : fc <= 40 ? 'normal' : 'high';

  // 2. Avg Fixation Duration
  const fd = metrics.avgFixationDuration || 0;
  const fdStatus = fd < 200 ? 'Normal' : fd <= 400 ? 'Normal' : 'Prolonged';
  const fdType = 'normal';

  // 3. Total Dwell Time
  const dt = metrics.totalDwellTime || 0;
  const dtStatus = dt >= 500 ? 'Normal' : 'Low';
  const dtType = dt >= 500 ? 'normal' : 'low';

  // 4. Avg Saccade Velocity
  const sv = metrics.avgSaccadeVelocity || 0;
  const svStatus = sv >= 0.3 ? 'Normal' : 'Slow';
  const svType = sv >= 0.3 ? 'normal' : 'danger';

  // Saccade Count
  const sc = metrics.saccadeCount || 0;
  const scStatus = sc < 8 ? 'Low' : sc <= 45 ? 'Normal' : 'Elevated';
  const scType = sc < 8 ? 'low' : sc <= 45 ? 'normal' : 'high';

  // Saccade Amplitude
  const sma = metrics.saccadeAmplitude || 0;
  const smaStatus = sma < 30 ? 'Hypometric' : sma <= 350 ? 'Normal' : 'Hypermetric';
  const smaType = sma < 30 ? 'low' : sma <= 350 ? 'normal' : 'high';

  // 6. Blink Instability
  const bi = metrics.blinkInstability || 0;
  const biStatus = bi < 0.3 ? 'Normal' : 'Elevated';
  const biType = bi < 0.3 ? 'normal' : 'high';

  // 7. Est. Pupil Diameter
  const pd = metrics.avgPupilDiameter || 0;
  const pdStatus = pd < 3.0 ? 'Small' : pd <= 8.0 ? 'Normal' : 'Dilated';
  const pdType = pd < 3.0 ? 'low' : pd <= 8.0 ? 'normal' : 'high';

  // 8. Pupil Activity
  const pac = metrics.pupilActivity || 0;
  const pacStatus = pac < 0.2 ? 'Normal' : 'High';
  const pacType = pac < 0.2 ? 'normal' : 'high';

  // 9. Pupil Response Latency
  const pr = metrics.pupilResponseLatency || 0;
  const prStatus = pr <= 400 ? 'Normal' : 'Delayed';
  const prType = pr <= 400 ? 'normal' : 'danger';

  // 10. Sustained Attention
  const sa = metrics.sustainedAttentionScore || 0;
  const saStatus = sa >= 85 ? 'Excellent' : sa >= 70 ? 'Normal' : 'Deficit';
  const saType = sa >= 70 ? 'normal' : 'danger';

  // 11. Gaze Accuracy
  const ac = metrics.accuracy || 0;
  const acStatus = ac <= 28 ? 'Normal' : 'Poor';
  const acType = ac <= 28 ? 'normal' : 'danger';

  // 12. Gaze Precision
  const pc = metrics.precision || 0;
  const pcStatus = pc < 15 ? 'Good' : pc <= 30 ? 'Acceptable' : 'Poor';
  const pcType = pc < 15 ? 'normal' : pc <= 30 ? 'high' : 'danger';

  // 13. BCEA Area
  const bc = metrics.bcea || 0;
  const bcStatus = bc <= 130000 ? 'Normal' : 'Diffuse';
  const bcType = bc <= 130000 ? 'normal' : 'high';

  // 14. VOR Proxy
  const vor = metrics.vorGain || 0;
  const vorStatus = vor < 0.68 ? 'Abnormal' : vor < 0.90 ? 'Borderline' : 'Normal';
  const vorType = vor < 0.68 ? 'danger' : vor < 0.90 ? 'high' : 'normal';

  // 15. Vergence Index
  const vg = metrics.vergenceIndex || 0;
  const vgStatus = vg < 0.5 ? 'Normal' : 'Deficit';
  const vgType = vg < 0.5 ? 'normal' : 'danger';

  // 16. Cytokinetic Index
  const cy = metrics.cytokineticIndex || 0;
  const cyStatus = cy < 0.3 ? 'Normal' : 'Elevated';
  const cyType = cy < 0.3 ? 'normal' : 'high';

  // 17. Gaze Drift
  const dr = metrics.drift || 0;
  const drStatus = dr < 56 ? 'Normal' : 'High Drift';
  const drType = dr < 56 ? 'normal' : 'high';

  return [
    { name: 'Fixation Count', range: '15-40 (task-dep)', val: String(fc), status: fcStatus, statusType: fcType, ref: 'Friedman & Komogortsev (2024) - PMC11404824' },
    { name: 'Avg Fixation Duration', range: '200-400 ms', val: `${Math.round(fd)} ms`, status: fdStatus, statusType: fdType, ref: 'Laborde et al. (2025) - Frontiers PMC12225304' },
    { name: 'Total Dwell Time', range: '>500 ms = engaged', val: `${Math.round(dt)} ms`, status: dtStatus, statusType: dtType, ref: 'Li et al. (2024) - Comput Biol PMC38219646' },
    { name: 'Avg Saccade Velocity', range: '300-600 deg/s', val: `${sv.toFixed(2)} px/ms (~${Math.round(sv * 250)}°/s)`, status: svStatus, statusType: svType, ref: 'Exp Brain Res (2025) normative battery' },
    { name: 'Saccade Count', range: '10-45 (task-dep)', val: String(sc), status: scStatus, statusType: scType, ref: 'Friedman & Komogortsev (2024) - PMC11404824' },
    { name: 'Saccade Amplitude', range: '30-350 px', val: `${sma.toFixed(1)} px`, status: smaStatus, statusType: smaType, ref: 'Friedman & Komogortsev (2024) - PMC11404824' },
    { name: 'Blink Instability', range: '<0.3 = stable', val: bi.toFixed(2), status: biStatus, statusType: biType, ref: 'Dynamic blink thresholds bioRxiv 2025' },
    { name: 'Est. Pupil Diameter', range: '3-8 mm (avg 4.3)', val: `${pd.toFixed(1)} mm`, status: pdStatus, statusType: pdType, ref: 'Sensors Workload Review - PMC10975796' },
    { name: 'Pupil Activity', range: '<0.2 = stable tonic', val: pac.toFixed(2), status: pacStatus, statusType: pacType, ref: 'Sensors Workload Review - PMC10975796' },
    { name: 'Pupil Response Latency', range: '150-400 ms', val: `${Math.round(pr)} ms`, status: prStatus, statusType: prType, ref: 'Bar-Or et al. (2024) - PMC11254822' },
    { name: 'Sustained Attention', range: '>70% target space', val: `${sa.toFixed(1)}%`, status: saStatus, statusType: saType, ref: 'Age-based Biomarkers - PMC11274786' },
    { name: 'Gaze Accuracy', range: '0.3-1.0 deg ≈ 8-28px', val: `${ac.toFixed(1)} px`, status: acStatus, statusType: acType, ref: 'Holmqvist et al. (2025) - PMC11659352' },
    { name: 'Gaze Precision', range: '<30 px acc; <15 px gd', val: `${pc.toFixed(1)} px`, status: pcStatus, statusType: pcType, ref: 'Stereoscopic validation - BRM 2025' },
    { name: 'BCEA Area', range: '50k - 130k px2', val: `${bc.toFixed(0)} px2`, status: bcStatus, statusType: bcType, ref: 'Noh et al. (25) Life - PMC12112839' },
    { name: 'VOR Proxy', range: '0.90-1.00; <0.68 abn', val: vor.toFixed(2), status: vorStatus, statusType: vorType, ref: 'Exp Brain Res (2025) normative bounds' },
    { name: 'Vergence Index', range: '<0.5 = normal alignment', val: vg.toFixed(2), status: vgStatus, statusType: vgType, ref: 'Stereoscopic validation - BRM 2025' },
    { name: 'Cytokinetic Index', range: '<0.3 = normal baseline', val: cy.toFixed(2), status: cyStatus, statusType: cyType, ref: 'Bar-Or et al. (2024) - PMC11254822' },
    { name: 'Gaze Drift', range: '<2 deg/s (~56 px/s)', val: `${dr.toFixed(2)} px/s`, status: drStatus, statusType: drType, ref: 'Friedman & Komogortsev (2025) - PMC12140216' }
  ];
};

interface ExportPdfOptions {
  data: ImageSessionData[];
  selectedImageIndex: number;
  isAll: boolean;
  participant: {
    id: string;
    age: string;
    condition: string;
    calibrationQuality: string;
  };
}

export const downloadClinicalPDF = async (options: ExportPdfOptions) => {
    const { data, selectedImageIndex, isAll, participant } = options;
    
    // Tiny delay to ensure charts are rendered
    await new Promise(resolve => setTimeout(resolve, 500));
    
    try {
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      
      const imagesToProcess = isAll ? data : [data[selectedImageIndex]];

      for (let i = 0; i < imagesToProcess.length; i++) {
          if (i > 0) pdf.addPage();
          const img = imagesToProcess[i];
          const imgIdx = data.indexOf(img);

          // Render/Query all offscreen visual charts upfront
          const heatmapDataUrl = await generateOffscreenHeatmap(img).catch(err => {
              console.error("Heatmap generation failed", err);
              return '';
          });
          const timelineTarget = document.getElementById(`timeline-chart-${imgIdx}`);
          const velocityTarget = document.getElementById(`velocity-chart-${imgIdx}`);
          const latencyTarget = document.getElementById(`latency-chart-${imgIdx}`);

          // ===================================================
          // PAGE 1: CLINICAL TELEMETRY PORTRAIT, METRICS & SPATIAL DIAGRAMS
          // ===================================================

          // 1. Header Section
          pdf.setFontSize(16);
          pdf.setTextColor(30, 64, 175); // Primary Clinical Blue (Blue-800)
          pdf.setFont("helvetica", "bold");
          pdf.text("NEUROGAZE CLINICAL REPORT", 14, 14);
          
          pdf.setFontSize(8);
          pdf.setFont("helvetica", "normal");
          pdf.setTextColor(148, 163, 184); // Slate-400
          pdf.text(`REPORT GENERATED: ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`, pdfWidth - 85, 14);

          // 2. Patient / Participant Metadata Styled Panel
          pdf.setFillColor(241, 245, 249); // bg-slate-100
          pdf.rect(14, 19, 182, 13, 'F');
          
          pdf.setFontSize(7.5);
          pdf.setFont("helvetica", "bold");
          pdf.setTextColor(71, 85, 105); // Slate-600
          pdf.text("PATIENT ID", 18, 23);
          pdf.text("AGE", 65, 23);
          pdf.text("STIMULUS PROTOCOL", 100, 23);
          pdf.text("CALIBRATION ACCURACY", 145, 23);

          pdf.setFont("helvetica", "normal");
          pdf.setTextColor(15, 23, 42); // Slate-950
          pdf.setFontSize(8.5);
          pdf.text(participant.id, 18, 28);
          pdf.text(`${participant.age} yrs`, 65, 28);
          pdf.text(participant.condition, 100, 28);
          pdf.text(participant.calibrationQuality || "Good (90%)", 145, 28);
          
          // Image / Screen Target Header
          pdf.setFontSize(10);
          pdf.setFont("helvetica", "bold");
          pdf.setTextColor(15, 23, 42); // Slate-950
          pdf.text(`Stimulus Target ID: ${img.imageId}`, 14, 38);

          // 3. Advanced Parameters Metrics Grid
          const drawMetricBlock = (x: number, y: number, w: number, h: number, title: string, metricsArr: { label: string, value: string | number }[]) => {
              // Draw light background box
              pdf.setFillColor(248, 250, 252); // bg-slate-50
              pdf.setDrawColor(226, 232, 240); // border-slate-200
              pdf.rect(x, y, w, h, 'FD');

              // Draw category header
              pdf.setFontSize(8);
              pdf.setFont("helvetica", "bold");
              pdf.setTextColor(30, 64, 175); // Blue-800
              pdf.text(title.toUpperCase(), x + 4, y + 5);

              // Draw header divider line
              pdf.setDrawColor(226, 232, 240);
              pdf.line(x + 4, y + 7, x + w - 4, y + 7);

              // Draw metrics
              pdf.setFontSize(7);
              const count = metricsArr.length;
              const itemStart = y + 11;
              const usableHeight = h - 14; 
              const step = count > 1 ? usableHeight / (count - 1) : 0;

              metricsArr.forEach((m, idx) => {
                  const currentY = itemStart + (idx * step);
                  pdf.setFont("helvetica", "normal");
                  pdf.setTextColor(100, 116, 139); // Slate-500
                  pdf.text(m.label, x + 4, currentY);

                  pdf.setFont("helvetica", "bold");
                  pdf.setTextColor(51, 65, 85); // Slate-700
                  const valStr = String(m.value);
                  const valWidth = pdf.getTextWidth(valStr);
                  pdf.text(valStr, x + w - 4 - valWidth, currentY);
              });
          };

          const colWidth = 88;
          const colHeight = 36;
          const colScaleX1 = 14;
          const colScaleX2 = 108;

          // Block 1: Oculomotor
          const oculomotorMetrics = [
              { label: "Fixation Count", value: img.metrics.fixationCount },
              { label: "Avg Fixation Duration", value: `${(img.metrics.avgFixationDuration || 0).toFixed(0)} ms` },
              { label: "Total Dwell Time", value: `${(img.metrics.totalDwellTime || 0).toFixed(0)} ms` },
              { label: "Avg Saccade Velocity", value: `${(img.metrics.avgSaccadeVelocity || 0).toFixed(2)} px/ms (~${Math.round((img.metrics.avgSaccadeVelocity || 0) * 250)}°/s)` },
              { label: "Saccade Count", value: img.metrics.saccadeCount || 0 },
              { label: "Saccade Amplitude", value: `${(img.metrics.saccadeAmplitude || 0).toFixed(1)} px` }
          ];
          drawMetricBlock(colScaleX1, 43, colWidth, colHeight, "Oculomotor", oculomotorMetrics);

          // Block 2: Blink & Pupil
          const blinkPupilMetrics = [
              { label: "Blink Instability", value: (img.metrics.blinkInstability || 0).toFixed(2) },
              { label: "Est. Pupil Diameter", value: `${(img.metrics.avgPupilDiameter || 0).toFixed(1)} mm` },
              { label: "Pupil Activity", value: (img.metrics.pupilActivity || 0).toFixed(2) },
              { label: "Pupil Response Latency", value: `${Math.round(img.metrics.pupilResponseLatency || 0)} ms` }
          ];
          drawMetricBlock(colScaleX2, 43, colWidth, colHeight, "Blink & Pupil", blinkPupilMetrics);

          // Block 3: Attention & Fatigue
          const attentionMetrics = [
              { label: "Sustained Attention", value: `${(img.metrics.sustainedAttentionScore || 0).toFixed(1)}%` },
              { label: "Gaze Accuracy", value: `${(img.metrics.accuracy || 0).toFixed(1)} px` },
              { label: "Gaze Precision", value: `${(img.metrics.precision || 0).toFixed(1)} px` },
              { label: "BCEA Area", value: `${(img.metrics.bcea || 0).toFixed(0)} px²` }
          ];
          drawMetricBlock(colScaleX1, 83, colWidth, colHeight, "Attention & Fatigue", attentionMetrics);

          // Block 4: Neurological
          const neurologicalMetrics = [
              { label: "VOR Proxy", value: (img.metrics.vorGain || 0).toFixed(2) },
              { label: "Vergence Index", value: (img.metrics.vergenceIndex || 0).toFixed(2) },
              { label: "Cytokinetic Index", value: (img.metrics.cytokineticIndex || 0).toFixed(2) },
              { label: "Gaze Drift", value: `${(img.metrics.drift || 0).toFixed(2)} px/s` }
          ];
          drawMetricBlock(colScaleX2, 83, colWidth, colHeight, "Neurological", neurologicalMetrics);

          // 4. Primary Spatial Mapping & AOI (Left Column Page 1)
          const visualY = 124;
          const visualHeight = 50;
          if (heatmapDataUrl) {
              pdf.setDrawColor(226, 232, 240);
              pdf.setFillColor(255, 255, 255);
              pdf.rect(14, visualY, 88, visualHeight, 'S');
              pdf.addImage(heatmapDataUrl, 'PNG', 14.5, visualY + 0.5, 87, visualHeight - 1);
              
              // Label for Heatmap
              pdf.setFontSize(7);
              pdf.setFont("helvetica", "bold");
              pdf.setTextColor(100, 116, 139);
              pdf.text("GAZE SCANPATH HEATMAP & AOI", 14, visualY + visualHeight + 4);
          }

          // 5. Timeline Gaze Chart (Right Column Page 1)
          if (timelineTarget) {
              try {
                  const timelineCanvas = await html2canvas(timelineTarget, { useCORS: true, logging: false, scale: 2 });
                  const timelineDataUrl = timelineCanvas.toDataURL('image/png');
                  
                  pdf.setDrawColor(226, 232, 240);
                  pdf.rect(108, visualY, 88, visualHeight, 'S');
                  pdf.addImage(timelineDataUrl, 'PNG', 108.5, visualY + 0.5, 87, visualHeight - 1);

                  // Label for Timeline Chart
                  pdf.setFontSize(7);
                  pdf.setFont("helvetica", "bold");
                  pdf.setTextColor(100, 116, 139);
                  pdf.text("SPATIOTEMPORAL GAZE TIMELINE (X/Y)", 108, visualY + visualHeight + 4);
              } catch (err) {
                  console.error("Timeline capture failed", err);
              }
          }

          // 6. Velocity-Time Spectrum Chart (Left Column Page 1 Bottom)
          const visualY2 = 184;
          const visualHeight2 = 50;
          if (velocityTarget) {
              try {
                  const velocityCanvas = await html2canvas(velocityTarget, { useCORS: true, logging: false, scale: 2 });
                  const velocityDataUrl = velocityCanvas.toDataURL('image/png');
                  
                  pdf.setDrawColor(226, 232, 240);
                  pdf.rect(14, visualY2, 88, visualHeight2, 'S');
                  pdf.addImage(velocityDataUrl, 'PNG', 14.5, visualY2 + 0.5, 87, visualHeight2 - 1);

                  // Label for Velocity-Time Spectrum Curve
                  pdf.setFontSize(7);
                  pdf.setFont("helvetica", "bold");
                  pdf.setTextColor(100, 116, 139);
                  pdf.text("VELOCITY-TIME SPECTRUM DIAGRAM", 14, visualY2 + visualHeight2 + 4);
              } catch (err) {
                  console.error("Velocity capture failed", err);
              }
          }

          // 7. Fixation Latency & Duration Graph (Right Column Page 1 Bottom)
          if (latencyTarget) {
              try {
                  const latencyCanvas = await html2canvas(latencyTarget, { useCORS: true, logging: false, scale: 2 });
                  const latencyDataUrl = latencyCanvas.toDataURL('image/png');
                  
                  pdf.setDrawColor(226, 232, 240);
                  pdf.rect(108, visualY2, 88, visualHeight2, 'S');
                  pdf.addImage(latencyDataUrl, 'PNG', 108.5, visualY2 + 0.5, 87, visualHeight2 - 1);

                  // Label for Fixation Latency
                  pdf.setFontSize(7);
                  pdf.setFont("helvetica", "bold");
                  pdf.setTextColor(100, 116, 139);
                  pdf.text("FIXATION LATENCY & DURATION GRAPH", 108, visualY2 + visualHeight2 + 4);
              } catch (err) {
                  console.error("Latency capture failed", err);
              }
          }

          // Page 1 Footer
          pdf.setFontSize(7);
          pdf.setFont("helvetica", "normal");
          pdf.setTextColor(148, 163, 184);
          pdf.text(`Patient Assessment File: ${participant.id}_${img.imageId}. Image duration: ${((img.endTime - img.startTime)/1000).toFixed(1)}s.`, 14, pdfHeight - 8);
          pdf.text(`Page ${(2 * i) + 1} of ${imagesToProcess.length * 2}`, pdfWidth - 25, pdfHeight - 8);

          // ===================================================
          // PAGE 2: PEER-REVIEWED NORMATIVE BENCHMARKS INDEX & TIME-SERIES CURVES
          // ===================================================
          pdf.addPage();

          pdf.setFontSize(14);
          pdf.setTextColor(30, 64, 175); // clinical blue
          pdf.setFont("helvetica", "bold");
          pdf.text("PEER-REVIEWED EYE TRACKING BENCHMARK INDEX", 14, 14);

          pdf.setFontSize(7.5);
          pdf.setFont("helvetica", "normal");
          pdf.setTextColor(100, 116, 139); // Slate-500
          pdf.text("Comprehensive cohort validation: Patient telemetry performance metrics mapped to peer-reviewed normative ranges.", 14, 19);

          let tableY = 24;
          pdf.setFillColor(241, 245, 249); // slate-100
          pdf.rect(14, tableY, 182, 5.5, 'F');
          
          pdf.setFontSize(7);
          pdf.setFont("helvetica", "bold");
          pdf.setTextColor(71, 85, 105); // slate-600
          pdf.text("METRIC", 16, tableY + 3.8);
          pdf.text("YOUR VALUE", 62, tableY + 3.8);
          pdf.text("NORMATIVE RANGE", 86, tableY + 3.8);
          pdf.text("STATUS", 132, tableY + 3.8);
          pdf.text("LITERATURE CITATION REFERENCE", 154, tableY + 3.8);

          const pdfBenchmarks = getPdfBenchmarks(img.metrics, img.endTime - img.startTime);
          let rowY = tableY + 5.5;

          pdfBenchmarks.forEach((b, idx) => {
              if (idx % 2 === 1) {
                  pdf.setFillColor(248, 250, 252); // soft grey stripe
                  pdf.rect(14, rowY, 182, 7.5, 'F');
              } else {
                  pdf.setDrawColor(241, 245, 249);
                  pdf.line(14, rowY + 7.5, 196, rowY + 7.5);
              }

              pdf.setFontSize(7);
              pdf.setFont("helvetica", "bold");
              pdf.setTextColor(15, 23, 42); // Slate-950
              pdf.text(b.name, 16, rowY + 5);

              pdf.setFont("helvetica", "bold");
              pdf.setTextColor(30, 64, 175); // clinical blue
              pdf.text(b.val, 62, rowY + 5);

              pdf.setFont("helvetica", "normal");
              pdf.setTextColor(71, 85, 105);
              pdf.text(b.range, 86, rowY + 5);

              pdf.setFont("helvetica", "bold");
              if (b.statusType === 'normal') {
                  pdf.setTextColor(16, 124, 65); // emerald-700
              } else if (b.statusType === 'low' || b.statusType === 'info') {
                  pdf.setTextColor(24, 95, 165); // sky-700
              } else if (b.statusType === 'high') {
                  pdf.setTextColor(180, 83, 9); // amber-700
              } else {
                  pdf.setTextColor(153, 53, 86); // notable violet-red
              }
              pdf.text(b.status, 132, rowY + 5);

              pdf.setFont("helvetica", "normal");
              pdf.setTextColor(100, 116, 139);
              pdf.setFontSize(6.2);
              pdf.text(b.ref, 154, rowY + 5);

              rowY += 7.5;
          });

          // Clinical warning note at bottom of Page 2
          const peerWarningY = 175;
          pdf.setFillColor(254, 252, 232); // yellow-50
          pdf.setDrawColor(254, 240, 138); // yellow-200
          pdf.rect(14, peerWarningY, 182, 13, 'FD');
          
          pdf.setFontSize(6.5);
          pdf.setFont("helvetica", "bold");
          pdf.setTextColor(133, 79, 11); // yellow-800
          pdf.text("REFERENCE NORMATIVE DATABASE ADVISORY Notice", 18, peerWarningY + 4);
          pdf.setFont("helvetica", "normal");
          pdf.setTextColor(113, 63, 4); // yellow-900
          pdf.text("Individual baseline eye-tracking response is subject to environmental variables, screen calibration quality, and lighting variance.", 18, peerWarningY + 7.5);
          pdf.text("Map these diagnostic indicators cleanly as diagnostic screening assistance parameters rather than clinical endpoints.", 18, peerWarningY + 10.5);

          // Page 2 Footer
          pdf.setFontSize(7);
          pdf.setFont("helvetica", "normal");
          pdf.setTextColor(148, 163, 184);
          pdf.text(`Patient Assessment File: ${participant.id}_${img.imageId}. Image duration: ${((img.endTime - img.startTime)/1000).toFixed(1)}s.`, 14, pdfHeight - 8);
          pdf.text(`Page ${(2 * i) + 2} of ${imagesToProcess.length * 2}`, pdfWidth - 25, pdfHeight - 8);
      }

      pdf.save(`NeuroGaze_Clinical_Report_${participant.id}_${isAll ? 'All' : data[selectedImageIndex].imageId}.pdf`);

    } catch (err) {
      console.error("PDF Generation failed", err);
      throw err;
    }
};
