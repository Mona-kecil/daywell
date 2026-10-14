export const HALF_LIFE_H = 5;
export const SLEEP_READY_MG = 50;
// FDA: up to 400 mg/day is generally not associated with negative effects in healthy adults.
export const DAILY_LIMIT_MG = 400;
export const ABSORB_MIN = 45;

// Typical USDA FoodData Central / label values per serving.
export const CAFFEINE_PRESETS: readonly {
  id: string;
  name: string;
  mg: number;
  serving: string;
}[] = [
  { id: "espresso", name: "Espresso", mg: 63, serving: "1 shot · 30 ml" },
  { id: "coffee", name: "Brewed coffee", mg: 95, serving: "1 cup · 240 ml" },
  { id: "cold-brew", name: "Cold brew", mg: 155, serving: "1 cup · 240 ml" },
  { id: "black-tea", name: "Black tea", mg: 47, serving: "1 cup · 240 ml" },
  { id: "green-tea", name: "Green tea", mg: 28, serving: "1 cup · 240 ml" },
  { id: "cola", name: "Cola", mg: 34, serving: "1 can · 355 ml" },
  { id: "energy", name: "Energy drink", mg: 80, serving: "1 can · 250 ml" },
];

export type Dose = { at: number; mg: number };

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const ABSORB_MS = ABSORB_MIN * MINUTE_MS;
const DECAY_RATE = Math.LN2 / (HALF_LIFE_H * HOUR_MS);

export function caffeineAt(
  doses: readonly Dose[],
  t: number,
  halfLifeH = HALF_LIFE_H,
): number {
  let mg = 0;
  for (const dose of doses) {
    if (dose.at > t) continue;
    const elapsed = t - dose.at;
    mg +=
      dose.mg *
      Math.min(1, elapsed / ABSORB_MS) *
      0.5 ** (elapsed / (halfLifeH * HOUR_MS));
  }
  return mg;
}

export function caffeineCurve(
  doses: readonly Dose[],
  from: number,
  to: number,
  stepMin: number,
): { t: number; mg: number }[] {
  const stepMs = stepMin * MINUTE_MS;
  if (
    !Number.isFinite(stepMs) ||
    stepMs <= 0 ||
    !Number.isFinite(from) ||
    !Number.isFinite(to) ||
    to < from
  )
    throw new Error("Use a positive step and a valid time range.");
  const intervals = Math.ceil((to - from) / stepMs);
  if (intervals >= 1000) throw new Error("Curve exceeds 1,000 points.");
  return Array.from({ length: intervals + 1 }, (_, i) => {
    const t = i === intervals ? to : from + i * stepMs;
    return { t, mg: caffeineAt(doses, t) };
  });
}

function curvePoints(doses: readonly Dose[], now: number) {
  const boundaries = new Set([now]);
  for (const dose of doses) {
    if (dose.at > now) boundaries.add(dose.at);
    if (dose.at + ABSORB_MS > now) boundaries.add(dose.at + ABSORB_MS);
  }
  const times = [...boundaries].sort((a, b) => a - b);
  const points = times.map((t) => ({ t, mg: caffeineAt(doses, t) }));
  for (let i = 0; i < times.length - 1; i++) {
    const from = times[i];
    const to = times[i + 1];
    let ramp = 0;
    for (const dose of doses) {
      if (dose.at <= from && from < dose.at + ABSORB_MS)
        ramp +=
          (dose.mg / ABSORB_MS) * Math.exp(-DECAY_RATE * (from - dose.at));
    }
    // Between boundaries the level is (C + ramp * dt) * exp(-rate * dt).
    // Its derivative has at most one zero, so these points bound every peak.
    if (ramp > 0) {
      const t = from + 1 / DECAY_RATE - caffeineAt(doses, from) / ramp;
      if (t > from && t < to) points.push({ t, mg: caffeineAt(doses, t) });
    }
  }
  return points.sort((a, b) => a.t - b.t);
}

export function peakAfter(
  doses: readonly Dose[],
  now: number,
): { t: number; mg: number } {
  return curvePoints(doses, now).reduce((peak, point) =>
    point.mg > peak.mg ? point : peak,
  );
}

export function sleepReadyAt(
  doses: readonly Dose[],
  now: number,
  threshold = SLEEP_READY_MG,
): number | null {
  if (threshold < 0 || (threshold === 0 && doses.some((dose) => dose.mg > 0)))
    return null;
  const points = curvePoints(doses, now);
  const lastAbove = points.findLastIndex((point) => point.mg > threshold);
  if (lastAbove < 0) return now;
  const deadline = now + 48 * HOUR_MS;
  const crossingStart = points[lastAbove].t;
  const crossingEnd = Math.min(points[lastAbove + 1]?.t ?? deadline, deadline);
  if (crossingStart >= deadline || caffeineAt(doses, crossingEnd) > threshold)
    return null;
  // Search whole minutes on the final falling interval to avoid rounding an
  // exact minute crossing up by another minute through floating-point error.
  let low = Math.floor(crossingStart / MINUTE_MS);
  let high = Math.ceil(crossingEnd / MINUTE_MS);
  while (high - low > 1) {
    const mid = Math.floor(low + (high - low) / 2);
    if (caffeineAt(doses, mid * MINUTE_MS) > threshold) low = mid;
    else high = mid;
  }
  return high * MINUTE_MS;
}

export function dayTotal(
  doses: readonly Dose[],
  startMs: number,
  endMs: number,
): number {
  return doses.reduce(
    (total, dose) =>
      total + (dose.at >= startMs && dose.at < endMs ? dose.mg : 0),
    0,
  );
}
