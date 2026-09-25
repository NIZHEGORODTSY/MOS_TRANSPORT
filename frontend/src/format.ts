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

const MSK_TIME = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' });
const MSK_CLOCK = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Europe/Moscow',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

export const formatTimeMsk = (iso: string) => MSK_TIME.format(new Date(iso));
export const formatClockMsk = (iso: string) => MSK_CLOCK.format(new Date(iso));

export function formatDelay(seconds: number): string {
  const sign = seconds > 0 ? '+' : seconds < 0 ? '−' : '';
  const abs = Math.abs(Math.round(seconds));
  const m = Math.floor(abs / 60);
  const s = abs % 60;
  return `${sign}${m}:${s.toString().padStart(2, '0')}`;
}
