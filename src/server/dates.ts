import { todayIn } from '../timezone';

/** Today's date (ISO) in the business time zone, so an evening in Chicago is not "tomorrow" in UTC. */
export function today(tz?: string): string { return todayIn(tz); }
