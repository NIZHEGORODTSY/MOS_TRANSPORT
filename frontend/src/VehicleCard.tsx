import { DelayChart } from './DelayChart';
import { STATUS_COLOR, STATUS_LABEL, formatDelay } from './format';
import type { Route, Vehicle } from './types';

interface Props {
  vehicle: Vehicle;
  route: Route | undefined;
  stepS: number;
  horizonS: number;
  onClose: () => void;
  onFly: () => void;
}

export function VehicleCard({ vehicle: v, route, stepS, horizonS, onClose, onFly }: Props) {
  return (
    <section className="card">
      <header className="card-head">
        <span className="route-badge" style={{ background: route?.color }}>
          {v.route_name}
        </span>
        <div className="card-title">
          <div>Борт {v.board}</div>
          <div className="muted small">{route?.title}</div>
        </div>
        <button className="icon-btn" onClick={onFly} title="Показать на карте" aria-label="Показать на карте">
          ◎
        </button>
        <button className="icon-btn" onClick={onClose} title="Закрыть" aria-label="Закрыть">
          ×
        </button>
      </header>

      <div className="card-stats">
        <div>
          <div className="muted small">Сейчас</div>
          <div className="stat-value">{formatDelay(v.delay_s)}</div>
        </div>
        <div>
          <div className="muted small">Через {Math.round(horizonS / 60)} мин</div>
          <div className="stat-value" style={{ color: STATUS_COLOR[v.status] }}>
            {formatDelay(v.predicted_delay_s)}
          </div>
        </div>
        <div>
          <div className="muted small">Скорость</div>
          <div className="stat-value">{v.speed_kmh.toFixed(0)} км/ч</div>
        </div>
      </div>

      <DelayChart
        history={v.history}
        delay={v.delay_s}
        predicted={v.predicted_delay_s}
        status={v.status}
        stepS={stepS}
        horizonS={horizonS}
      />

      <div className="card-foot">
        <span className="status-pill" style={{ color: STATUS_COLOR[v.status], borderColor: STATUS_COLOR[v.status] }}>
          {STATUS_LABEL[v.status]}
        </span>
        <span className="muted small">След. остановка: {v.next_stop}</span>
      </div>
    </section>
  );
}
