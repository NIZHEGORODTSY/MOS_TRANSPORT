import {useEffect, useState} from "react";
import {RISK} from "../routeColors";

const W = 288;
const H = 128;
const PAD = {left: 26, right: 6, top: 8, bottom: 18};

const MSK_HM = new Intl.DateTimeFormat("ru-RU", {timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit"});

// risk zones in minutes of delay, same thresholds as backend predictor.risk_level
const ZONES = [
    {risk: "late", from: 3, to: Infinity},
    {risk: "risk", from: 1, to: 3},
    {risk: "on_time", from: -1, to: 1},
    {risk: "early", from: -Infinity, to: -1},
];
const TICKS = [-1, 0, 1, 3];

/** Predicted delay of a vehicle over the last hour: x — moment of prediction T, y — delay at the target stop. */
export default function DeviationChart({apiUrl, trId, version}) {
    const [series, setSeries] = useState(null);

    // reloaded whenever the backend publishes a new prediction (version = its computed_at)
    useEffect(() => {
        let cancelled = false;
        fetch(`${apiUrl}/api/predictions/${trId}/history`)
            .then((r) => (r.ok ? r.json() : []))
            .then((data) => !cancelled && setSeries(data))
            .catch(() => !cancelled && setSeries([]));
        return () => {
            cancelled = true;
        };
    }, [apiUrl, trId, version]);

    if (series === null) return null;
    if (series.length < 2) {
        return <div className="chart-empty sb-muted">График появится после нескольких прогнозов</div>;
    }

    const ts = series.map((p) => Date.parse(p.at));
    const ys = series.map((p) => p.delay_s / 60);
    const yMin = Math.min(-2, ...ys);
    const yMax = Math.max(4, ...ys);
    const x = (t) => PAD.left + ((t - ts[0]) / (ts[ts.length - 1] - ts[0] || 1)) * (W - PAD.left - PAD.right);
    const y = (m) => PAD.top + ((yMax - m) / (yMax - yMin)) * (H - PAD.top - PAD.bottom);
    const clampY = (m) => y(Math.max(yMin, Math.min(yMax, m)));

    return (
        <figure className="chart">
            <figcaption className="sb-label">Отклонение от графика, мин</figcaption>
            <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="График прогноза отклонения от графика">
                {ZONES.map((z) => (
                    <rect
                        key={z.risk}
                        x={PAD.left}
                        width={W - PAD.left - PAD.right}
                        y={clampY(z.to)}
                        height={clampY(z.from) - clampY(z.to)}
                        fill={RISK[z.risk].color}
                        opacity={0.08}
                    />
                ))}
                {TICKS.map((m) => (
                    <g key={m}>
                        <line
                            x1={PAD.left} x2={W - PAD.right} y1={y(m)} y2={y(m)}
                            className={m === 0 ? "chart-zero" : "chart-grid"}
                        />
                        <text x={PAD.left - 4} y={y(m) + 3} textAnchor="end" className="chart-tick">
                            {m > 0 ? `+${m}` : m < 0 ? `−${-m}` : "0"}
                        </text>
                    </g>
                ))}
                <polyline className="chart-line" points={series.map((p, i) => `${x(ts[i])},${y(ys[i])}`).join(" ")}/>
                {series.map((p, i) => (
                    <circle
                        key={p.at}
                        cx={x(ts[i])}
                        cy={y(ys[i])}
                        r={i === series.length - 1 ? 3.5 : 2}
                        fill={RISK[p.risk]?.color ?? "currentColor"}
                    >
                        <title>{`${MSK_HM.format(ts[i])}: ${p.delay_s > 0 ? "+" : ""}${p.delay_s} с`}</title>
                    </circle>
                ))}
                <text x={PAD.left} y={H - 4} className="chart-tick">{MSK_HM.format(ts[0])}</text>
                <text x={W - PAD.right} y={H - 4} textAnchor="end" className="chart-tick">
                    {MSK_HM.format(ts[ts.length - 1])}
                </text>
            </svg>
        </figure>
    );
}
