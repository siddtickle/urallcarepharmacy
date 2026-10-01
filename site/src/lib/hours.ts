// Opening hours and the "Open now / Closed" logic. All times are store time (US Eastern).

export const STORE_TIME_ZONE = 'America/New_York';

/** Minutes after midnight [open, close] per weekday, Sunday = 0. null = closed all day. */
export const WEEKLY_HOURS: ([number, number] | null)[] = [
  null, // Sunday
  [9 * 60, 18 * 60], // Monday
  [9 * 60, 18 * 60],
  [9 * 60, 18 * 60],
  [9 * 60, 18 * 60],
  [9 * 60, 18 * 60], // Friday
  [10 * 60, 14 * 60], // Saturday
];

/**
 * Full-day closures, as YYYY-MM-DD in store time. Add holidays here, e.g. '2026-11-26'.
 * Special hours for a single day: add to SPECIAL_HOURS instead.
 */
export const CLOSED_DATES: string[] = [];
export const SPECIAL_HOURS: Record<string, [number, number]> = {};

export const HOURS_TEXT = 'Mon–Fri 9am–6pm · Sat 10am–2pm · Sun closed';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export interface StoreStatus {
  open: boolean;
  label: 'Open now' | 'Closing soon' | 'Closed';
  detail: string;
}

export function formatTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${m ? ':' + String(m).padStart(2, '0') : ''}${h < 12 ? 'am' : 'pm'}`;
}

/** Date parts of `at` in store time. */
function storeClock(at: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: STORE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return {
    ymd: `${get('year')}-${get('month')}-${get('day')}`,
    day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday')),
    minutes: (Number(get('hour')) % 24) * 60 + Number(get('minute')),
  };
}

/** Calendar date `n` days after the YYYY-MM-DD date `ymd`. */
function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function hoursOn(ymd: string, weekday: number): [number, number] | null {
  if (CLOSED_DATES.includes(ymd)) return null;
  return SPECIAL_HOURS[ymd] ?? WEEKLY_HOURS[weekday];
}

export function storeStatus(at: Date = new Date()): StoreStatus {
  const { ymd, day, minutes } = storeClock(at);
  const today = hoursOn(ymd, day);

  if (today && minutes >= today[0] && minutes < today[1]) {
    const soon = today[1] - minutes <= 30;
    return { open: true, label: soon ? 'Closing soon' : 'Open now', detail: `until ${formatTime(today[1])}` };
  }
  if (today && minutes < today[0]) {
    return { open: false, label: 'Closed', detail: `opens today at ${formatTime(today[0])}` };
  }
  for (let i = 1; i <= 14; i++) {
    const d = (day + i) % 7;
    const hrs = hoursOn(addDays(ymd, i), d);
    if (hrs) {
      const when = i === 1 ? 'tomorrow' : i < 7 ? DAY_NAMES[d] : `${DAY_NAMES[d]}, ${addDays(ymd, i).slice(5).replace('-', '/')}`;
      return { open: false, label: 'Closed', detail: `opens ${when} at ${formatTime(hrs[0])}` };
    }
  }
  return { open: false, label: 'Closed', detail: '' };
}
