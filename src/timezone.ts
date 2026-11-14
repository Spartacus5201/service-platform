// The office's time zone, one setting for everything: "today", dates worked out in SQL, times on screen and the
// daily backup. APP_TIMEZONE (an IANA name such as America/Chicago); APP_TZ is still read for older setups.
const DEFAULT = 'America/Chicago';

export function appTimeZone(): string {
  const tz = process.env.APP_TIMEZONE || process.env.APP_TZ || DEFAULT;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz; }
  catch { console.error(`[time zone] "${tz}" is not a time zone name; using ${DEFAULT}.`); return DEFAULT; }
}

/** Today's date (ISO yyyy-mm-dd) in the office's time zone. */
export function todayIn(tz = appTimeZone(), at = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}
