export function localDueDateToUtc(date, time, timezone) {
  if (!date) return null;
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = (time || "23:59").split(":").map(Number);
  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  let candidate = localAsUtc;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(candidate));
    const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
    const representedAsUtc = Date.UTC(
      Number(values.year), Number(values.month) - 1, Number(values.day),
      Number(values.hour), Number(values.minute)
    );
    const correction = localAsUtc - representedAsUtc;
    candidate += correction;
    if (correction === 0) break;
  }

  return new Date(candidate);
}