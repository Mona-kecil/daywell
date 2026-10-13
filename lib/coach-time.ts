export function normalizeTimeZone(timeZone: string): string {
  if (!/^[A-Za-z][A-Za-z0-9_+./-]*$/.test(timeZone))
    throw new RangeError("Expected an IANA time zone.");
  return new Intl.DateTimeFormat("en-US", { timeZone }).resolvedOptions()
    .timeZone;
}
export type LocalClock = {
  localDay: string;
  slot: string;
  localMinutes: number;
};
function clockFormatter(timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    calendar: "iso8601",
    numberingSystem: "latn",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}
function readClock(formatter: Intl.DateTimeFormat, at: number): LocalClock {
  const parts = formatter.formatToParts(at);
  const value = (type: Intl.DateTimeFormatPartTypes) => {
    const part = parts.find((p) => p.type === type);
    if (!part) throw new Error(`Missing clock part: ${type}`);
    return part.value;
  };
  const hour = value("hour"),
    minute = value("minute");
  return {
    localDay: `${value("year")}-${value("month")}-${value("day")}`,
    slot: `${hour}:${minute}`,
    localMinutes: Number(hour) * 60 + Number(minute),
  };
}
export function localClock(at: number, timeZone: string): LocalClock {
  return readClock(clockFormatter(timeZone), at);
}
export function dueSlots(input: {
  since: number;
  now: number;
  timeZone: string;
  checkIns: string[];
}) {
  const formatter = clockFormatter(input.timeZone);
  const slots = new Set(input.checkIns),
    seen = new Set<string>();
  const due: (LocalClock & { at: number })[] = [];
  // Walk real UTC minutes: skipped DST times never occur; folded times share a day/slot key.
  for (
    let at = (Math.floor(input.since / 60_000) + 1) * 60_000;
    at <= input.now;
    at += 60_000
  ) {
    const clock = readClock(formatter, at),
      key = `${clock.localDay}/${clock.slot}`;
    if (slots.has(clock.slot) && !seen.has(key)) {
      due.push({ ...clock, at });
      seen.add(key);
    }
  }
  return due;
}
