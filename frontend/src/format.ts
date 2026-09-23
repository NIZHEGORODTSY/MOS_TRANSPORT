import type { Status } from './types';

export const STATUS_COLOR: Record<Status, string> = {
  ok: '#30c46c',
  risk: '#f5a524',
  late: '#f2555a',
};

export const STATUS_LABEL: Record<Status, string> = {
  ok: 'В графике',
  risk: 'Риск задержки',
  late: 'Опоздание',
};

export function formatDelay(seconds: number): string {
  const sign = seconds > 0 ? '+' : seconds < 0 ? '−' : '';
  const abs = Math.abs(Math.round(seconds));
  const m = Math.floor(abs / 60);
  const s = abs % 60;
  return `${sign}${m}:${s.toString().padStart(2, '0')}`;
}
