/** 83.456 → "1:23.456" */
export function formatTime(t: number): string {
  if (!Number.isFinite(t)) return '--:--.---';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}

export const hexColor = (c: number): string => '#' + c.toString(16).padStart(6, '0');

export const ordinal = (n: number): string => `${n}${n === 1 ? 'er' : 'e'}`;
