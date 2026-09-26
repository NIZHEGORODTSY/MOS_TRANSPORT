import type { CSSProperties, ReactNode } from 'react';
import { STATUS_COLOR, STATUS_LABEL, formatClockMsk, formatDelay } from './format';
import type { ConnectionState, Route, Status, Vehicle } from './types';

interface Props {
  routes: Route[];
  vehicles: Vehicle[];
  counts: Record<Status, number>;
  total: number;
  connection: ConnectionState;
  clock: string | null;
  speed: number | null;
  hiddenRoutes: Set<string>;
  statusFilter: Status | null;
  selectedId: string | null;
  card: ReactNode;
  onToggleRoute: (id: string) => void;
  onShowAllRoutes: () => void;
  onStatusFilter: (s: Status | null) => void;
  onPick: (id: string) => void;
}

const CONNECTION_LABEL: Record<ConnectionState, string> = {
  connecting: 'подключение…',
  open: 'онлайн',
  closed: 'нет связи',
};

export function Sidebar(p: Props) {
  const routeById = new Map(p.routes.map((r) => [r.id, r]));

  return (
    <aside className="sidebar">
      <header className="sidebar-head">
        <div>
          <h1>MosTransport</h1>
          <div className="muted small">Прогноз задержек · горизонт 10–15 мин</div>
          {p.clock && (
            <div className="replay-clock small">
              {formatClockMsk(p.clock)} МСК{' '}
              <span className="muted">{p.speed ? `· воспроизведение ×${p.speed}` : '· время телеметрии'}</span>
            </div>
          )}
        </div>
        <span className={`conn conn-${p.connection}`}>
          <span className="conn-dot" />
          {CONNECTION_LABEL[p.connection]}
        </span>
      </header>

      <div className="kpis">
        <button
          className={`kpi ${p.statusFilter === null ? 'kpi-active' : ''}`}
          onClick={() => p.onStatusFilter(null)}
        >
          <span className="kpi-value">{p.total}</span>
          <span className="kpi-label">Всего ТС</span>
        </button>
        {(Object.keys(STATUS_COLOR) as Status[]).map((s) => (
          <button
            key={s}
            className={`kpi ${p.statusFilter === s ? 'kpi-active' : ''}`}
            style={{ '--accent': STATUS_COLOR[s] } as CSSProperties}
            onClick={() => p.onStatusFilter(p.statusFilter === s ? null : s)}
          >
            <span className="kpi-value" style={{ color: STATUS_COLOR[s] }}>
              {p.counts[s]}
            </span>
            <span className="kpi-label">{STATUS_LABEL[s]}</span>
          </button>
        ))}
      </div>

      <div className="route-chips">
        {p.routes.map((r) => {
          const off = p.hiddenRoutes.has(r.id);
          return (
            <button
              key={r.id}
              className={`chip ${off ? 'chip-off' : ''}`}
              onClick={() => p.onToggleRoute(r.id)}
              title={r.title}
              aria-pressed={!off}
            >
              <span className="dot" style={{ background: r.color }} />
              {r.name}
            </button>
          );
        })}
        {p.hiddenRoutes.size > 0 && (
          <button className="chip chip-link" onClick={p.onShowAllRoutes}>
            Все
          </button>
        )}
      </div>

      {p.card}

      <div className="list-head muted small">
        <span>Маршрут · борт</span>
        <span>Сейчас → прогноз</span>
      </div>
      <ul className="vehicle-list">
        {p.vehicles.map((v) => (
          <li key={v.id}>
            <button
              className={`vehicle-row ${v.id === p.selectedId ? 'vehicle-row-active' : ''}`}
              onClick={() => p.onPick(v.id)}
            >
              <span className="route-badge" style={{ background: routeById.get(v.route_id)?.color }}>
                {v.route_name}
              </span>
              <span className="vehicle-main">
                <span>ТС {v.board}</span>
                <span className="muted small ellipsis">{v.next_stop ?? '—'}</span>
              </span>
              <span className="vehicle-delay">
                <span className="muted">{formatDelay(v.delay_s)}</span>
                <span className="arrow">→</span>
                <b style={{ color: STATUS_COLOR[v.status] }}>{formatDelay(v.predicted_delay_s)}</b>
              </span>
            </button>
          </li>
        ))}
        {p.vehicles.length === 0 && <li className="empty muted">Нет транспорта по выбранным фильтрам</li>}
      </ul>
    </aside>
  );
}
