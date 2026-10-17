export interface HourWindow {
  key: string;
  label: string;
  ttl: number;
  nextHour: number;
}

export function getUtcHourWindow(date: Date): HourWindow {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const nextHour = Date.UTC(year, date.getUTCMonth(), date.getUTCDate(), date.getUTCHours() + 1);
  return {
    key: `${year}${month}${day}${hour}`,
    label: `${year}-${month}-${day} ${hour}:00`,
    ttl: Math.max(60, Math.ceil((nextHour - date.getTime()) / 1000) + 60),
    nextHour,
  };
}

export function getRateLimitDelay(nextHour: number, sequence: number): number {
  return nextHour + Math.min(sequence, 1000) * 100;
}
