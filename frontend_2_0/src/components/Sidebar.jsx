import {useMemo, useState} from "react";
import {colorForRoute, NO_ROUTE, NO_ROUTE_COLOR, ROUTE_PALETTE, routeKey} from "../routeColors";

const MSK_TIME = new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
});

const WS_LABEL = {connecting: "подключение…", open: "на связи", closed: "нет связи"};

const unitName = (u) => (u.tr_id != null ? `ТС ${u.tr_id}` : `Терминал ${u.unit_id}`);
const formatTime = (iso) => (iso ? MSK_TIME.format(new Date(iso)) : "—");
const formatAge = (s) => (s == null ? "—" : s < 60 ? `${Math.round(s)} с` : `${Math.round(s / 60)} мин`);

export default function Sidebar({
                                    units,
                                    wsStatus,
                                    clock,
                                    hiddenRoutes,
                                    onToggleRoute,
                                    onShowAllRoutes,
                                    statusFilter,
                                    onStatusFilter,
                                    stopsVisible,
                                    onStopsVisible,
                                    selectedId,
                                    onPick,
                                    onClose,
                                    dataStatus,
                                    onLogout,
                                }) {
    const [query, setQuery] = useState("");

    const inRoutes = useMemo(() => units.filter((u) => !hiddenRoutes.has(routeKey(u))), [units, hiddenRoutes]);
    const online = inRoutes.filter((u) => u.online).length;

    const list = useMemo(() => {
        const q = query.trim();
        return inRoutes
            .filter((u) => statusFilter === null || (statusFilter === "online") === !!u.online)
            .filter((u) => !q || String(u.tr_id ?? "").includes(q) || String(u.unit_id).includes(q))
            .sort((a, b) =>
                Number(b.online) - Number(a.online) ||
                (a.route_id ?? 99) - (b.route_id ?? 99) ||
                (a.tr_id ?? a.unit_id) - (b.tr_id ?? b.unit_id)
            );
    }, [inRoutes, statusFilter, query]);

    const selected = units.find((u) => u.unit_id === selectedId);

    const stats = [
        {key: null, label: "всего", value: inRoutes.length},
        {key: "online", label: "на связи", value: online},
        {key: "offline", label: "нет связи", value: inRoutes.length - online},
    ];
    const chips = [
        ...ROUTE_PALETTE.map((color, i) => ({key: String(i + 1), label: String(i + 1), color})),
        {key: NO_ROUTE, label: "—", color: NO_ROUTE_COLOR, title: "без маршрута (эмулятор)"},
    ];

    return (
        <aside className="sb">
            <header className="sb-head">
                <div className="sb-brand">
                    <img className="sb-logo" src="/favicon.svg" alt=""/>
                    <div>
                        <div className="sb-title">МосТранспорт</div>
                        <div className="sb-muted">{clock ? `${formatTime(clock)} МСК` : "нет данных телеметрии"}</div>
                    </div>
                </div>
                <span className={`sb-ws sb-ws-${wsStatus}`}>
                    <span className="sb-dot"/>
                    {WS_LABEL[wsStatus]}
                </span>
            </header>

            <section className="sb-stats">
                {stats.map((s) => (
                    <button
                        key={s.label}
                        className={`sb-stat ${statusFilter === s.key ? "is-active" : ""}`}
                        onClick={() => onStatusFilter(statusFilter === s.key ? null : s.key)}
                    >
                        <span className="sb-stat-value">{s.value}</span>
                        <span className="sb-muted">{s.label}</span>
                    </button>
                ))}
            </section>

            <section className="sb-section">
                <div className="sb-row">
                    <span className="sb-label">Маршруты</span>
                    {hiddenRoutes.size > 0 && (
                        <button className="sb-link" onClick={onShowAllRoutes}>показать все</button>
                    )}
                </div>
                <div className="sb-chips">
                    {chips.map((c) => (
                        <button
                            key={c.key}
                            className={`sb-chip ${hiddenRoutes.has(c.key) ? "is-off" : ""}`}
                            title={c.title ?? `маршрут ${c.label}`}
                            onClick={() => onToggleRoute(c.key)}
                        >
                            <span className="sb-dot" style={{background: c.color}}/>
                            {c.label}
                        </button>
                    ))}
                </div>
                <label className="sb-check">
                    <input type="checkbox" checked={stopsVisible} onChange={(e) => onStopsVisible(e.target.checked)}/>
                    Показывать остановки
                </label>
            </section>

            {selected && (
                <section className="sb-card">
                    <div className="sb-row">
                        <span className="sb-card-title">
                            <span className="sb-dot" style={{background: colorForRoute(selected.route_id)}}/>
                            {unitName(selected)}
                        </span>
                        <button className="sb-icon" onClick={onClose} aria-label="Закрыть">×</button>
                    </div>
                    <dl className="sb-props">
                        <dt>Маршрут</dt>
                        <dd>{selected.route_id ?? "—"}</dd>
                        <dt>Скорость</dt>
                        <dd>{selected.speed} км/ч</dd>
                        <dt>Курс</dt>
                        <dd>{selected.course}°</dd>
                        <dt>Пакет</dt>
                        <dd>{formatTime(selected.time)}</dd>
                        <dt>Связь</dt>
                        <dd>{selected.online ? "на связи" : `нет ${formatAge(selected.age_s)}`}</dd>
                        <dt>GPS</dt>
                        <dd>{selected.valid ? "есть" : "нет фиксации"}</dd>
                        <dt>Терминал</dt>
                        <dd>{selected.unit_id}</dd>
                    </dl>
                    <div className="sb-placeholder">Прогноз задержки появится после подключения модели</div>
                </section>
            )}

            <section className="sb-section sb-list-section">
                <input
                    className="sb-search"
                    placeholder="Поиск по номеру ТС"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                />
                <ul className="sb-list">
                    {list.map((u) => (
                        <li key={u.unit_id}>
                            <button
                                className={`sb-item ${u.unit_id === selectedId ? "is-active" : ""} ${u.online ? "" : "is-offline"}`}
                                onClick={() => onPick(u.unit_id)}
                            >
                                <span className="sb-dot" style={{background: colorForRoute(u.route_id)}}/>
                                <span className="sb-item-name">{unitName(u)}</span>
                                <span className="sb-muted">
                                    {u.online
                                        ? `${u.route_id != null ? `м. ${u.route_id} · ` : ""}${u.speed} км/ч`
                                        : `нет связи ${formatAge(u.age_s)}`}
                                </span>
                            </button>
                        </li>
                    ))}
                    {list.length === 0 && <li className="sb-empty sb-muted">Нет ТС по выбранным фильтрам</li>}
                </ul>
            </section>

            <footer className="sb-foot">
                <span className="sb-muted">{dataStatus}</span>
                <button className="sb-link" onClick={onLogout}>Выйти</button>
            </footer>
        </aside>
    );
}
