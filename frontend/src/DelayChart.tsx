import { STATUS_COLOR } from './format';
import type { Status } from './types';

interface Props {
  history: [number, number][];
  delay: number;
  predicted: number;
  status: Status;
  leadS: number;
  historyS: number;
  horizonS: number;
}

const W = 320;
const H = 120;
const PAD = { l: 38, r: 10, t: 10, b: 20 };
const THRESHOLDS = [
  { s: 120, color: STATUS_COLOR.risk, label: '2 мин' },
  { s: 300, color: STATUS_COLOR.late, label: '5 мин' },
];

export function DelayChart({ history, delay, predicted, status, leadS, historyS, horizonS }: Props) {
  const points = [...history.map(([ago, d]) => [-ago, d] as const), [0, delay] as const];
  const spread = Math.abs(predicted - delay) * 0.3 + 30;

  const lo = Math.min(0, ...points.map((p) => p[1]), predicted - spread);
  const hi = Math.max(360, ...points.map((p) => p[1]), predicted + spread) * 1.1;

  const x = (s: number) => PAD.l + ((s + historyS) / (historyS + horizonS)) * (W - PAD.l - PAD.r);
  const y = (d: number) => PAD.t + (1 - (d - lo) / (hi - lo)) * (H - PAD.t - PAD.b);

  const pastPath = points.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join(' ');
  const cone = [
    `M${x(0)},${y(delay)}`,
    `L${x(leadS)},${y(predicted + spread)}`,
    `L${x(leadS)},${y(predicted - spread)}`,
    'Z',
  ].join(' ');
  const color = STATUS_COLOR[status];

  return (
    <svg className="delay-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="История и прогноз задержки">
      <line x1={PAD.l} x2={W - PAD.r} y1={y(0)} y2={y(0)} className="chart-axis" />
      <text x={PAD.l - 6} y={y(0) + 3} className="chart-tick" textAnchor="end">
        0
      </text>
      {THRESHOLDS.filter((t) => t.s < hi).map((t) => (
        <g key={t.s}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(t.s)} y2={y(t.s)} stroke={t.color} className="chart-threshold" />
          <text x={PAD.l - 6} y={y(t.s) + 3} className="chart-tick" textAnchor="end">
            {t.label}
          </text>
        </g>
      ))}
      <line x1={x(0)} x2={x(0)} y1={PAD.t} y2={H - PAD.b} className="chart-now" />
      <path d={cone} fill={color} opacity={0.15} />
      <path d={pastPath} className="chart-line" />
      {history.map(([ago, d], i) => (
        <circle key={i} cx={x(-ago)} cy={y(d)} r={2} className="chart-now-dot" />
      ))}
      <line x1={x(0)} y1={y(delay)} x2={x(leadS)} y2={y(predicted)} stroke={color} strokeWidth={2} strokeDasharray="4 3" />
      <circle cx={x(0)} cy={y(delay)} r={3.5} className="chart-now-dot" />
      <circle cx={x(leadS)} cy={y(predicted)} r={4} fill={color} />
      <text x={PAD.l} y={H - 5} className="chart-tick">
        −{Math.round(historyS / 60)} мин
      </text>
      <text x={x(0)} y={H - 5} className="chart-tick" textAnchor="middle">
        сейчас
      </text>
      <text x={W - PAD.r} y={H - 5} className="chart-tick" textAnchor="end">
        +{Math.round(horizonS / 60)} мин
      </text>
    </svg>
  );
}
