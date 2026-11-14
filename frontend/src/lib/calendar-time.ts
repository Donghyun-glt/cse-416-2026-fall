/** Resolve a wall-clock time in an IANA zone, rejecting nonexistent/ambiguous DST times. */
export function calendarInstant(local: string, timeZone: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) throw new Error("Enter a valid date and time.");
  const target = Date.parse(`${local}:00Z`);
  if (!Number.isFinite(target)) throw new Error("Enter a valid date and time.");
  const formatter = new Intl.DateTimeFormat("sv-SE", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const wall = (instant: number) => {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map((part) => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
  };
  let instant = target;
  for (let i = 0; i < 3; i++) instant += target - Date.parse(`${wall(instant)}:00Z`);
  if (wall(instant) !== local) throw new Error("This time does not exist in the selected time zone.");
  if ([-7200000, -3600000, -1800000, 1800000, 3600000, 7200000].some((offset) => wall(instant + offset) === local)) throw new Error("This time is ambiguous due to daylight saving. Choose another time or use UTC.");
  return new Date(instant).toISOString();
}
