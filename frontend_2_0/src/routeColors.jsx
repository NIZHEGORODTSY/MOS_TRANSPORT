export const ROUTE_PALETTE = [
    "#4c8dff", "#a970ff", "#22c3e6", "#ff7ab8", "#3ddbb0", "#7f8cff", "#c77dff",
    "#5ec8ff", "#ff9ecf", "#6fe0c3", "#9aa7ff", "#e08aff", "#8fd3ff",
];

export const NO_ROUTE_COLOR = "#8b98a8";

// key of a vehicle's route in route filters; "none" for vehicles without a route (emulator)
export const NO_ROUTE = "none";
export const routeKey = (u) => (u.route_id == null ? NO_ROUTE : String(u.route_id));

// route = номер маршрута 1..13; null/undefined — ТС без маршрута (эмулятор)
export function colorForRoute(route) {
    if (route == null) return NO_ROUTE_COLOR;
    return ROUTE_PALETTE[(Number(route) - 1) % ROUTE_PALETTE.length];
}

// delay risk of a vehicle with a model prediction; keys match "risk" of /api/predictions (backend predictor.risk_level)
export const RISK = {
    late: {color: "#f25f5c", label: "опаздывает", hint: "> 3 мин", rank: 4},
    risk: {color: "#f0b429", label: "риск опоздания", hint: "1–3 мин", rank: 3},
    on_time: {color: "#3ecf8e", label: "успевает", hint: "± 1 мин", rank: 2},
    early: {color: "#ffffff", label: "раньше графика", hint: "> 1 мин", rank: 1},
};
export const RISK_ORDER = ["late", "risk", "on_time", "early"];
export const riskOf = (u) => (u.prediction ? RISK[u.prediction.risk] : null);
