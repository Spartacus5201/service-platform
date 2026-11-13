/** Today's date (ISO) in the business time zone, so an evening in Chicago is not "tomorrow" in UTC. */
export function today(tz = process.env.APP_TZ ?? 'America/Chicago'): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
