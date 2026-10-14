"use client";
import type { Id } from "@/convex/_generated/dataModel";
import { FORECAST_MS, ceilHour, forecast, midnights } from "@/lib/forecast";
import { recoveryHex, useIsDark } from "./body3d";
import { SectionTitle } from "./ui";

type Muscle = {
  _id: Id<"muscles">;
  name: string;
  lastTrainedAt: number | null;
  cooldownHours: number;
};

const HOUR = 3_600_000;
const pct = (ms: number) => (ms / FORECAST_MS) * 100;

function hourLabel(at: number, now: number) {
  const by = new Date(ceilHour(at));
  const today = by.toDateString() === new Date(now).toDateString();
  return by.toLocaleString(
    [],
    today ? { hour: "numeric" } : { weekday: "short", hour: "numeric" },
  );
}
const readyBy = (at: number, now: number) =>
  at <= now ? "Ready now" : `By ${hourLabel(at, now)}`;

// The bar follows the recovery colour from now until the muscle is ready.
function barStyle(m: Muscle, at: number, now: number, dark: boolean) {
  const cooldown = m.cooldownHours * HOUR;
  const shown = Math.min(at - now, FORECAST_MS);
  const start = Math.max(0, 1 - (at - now) / cooldown);
  const colour = (fraction: number) =>
    recoveryHex({ kind: "recovering", fraction, label: "" }, dark);
  // Where along the visible bar the muscle reaches this fraction.
  const stop = (fraction: number) =>
    `${colour(fraction)} ${((at - (1 - fraction) * cooldown - now) / shown) * 100}%`;
  const stops = [
    `${colour(start)} 0%`,
    ...(start < 0.5 ? [stop(0.5)] : []),
    stop(1),
  ];
  return {
    width: `${pct(shown)}%`,
    background: `linear-gradient(to right, ${stops.join(", ")})`,
  };
}

export function RecoveryForecast({
  muscles,
  now,
  onPlan,
}: {
  muscles: Muscle[];
  now: number;
  onPlan: (ids: Id<"muscles">[], label: string) => void;
}) {
  const dark = useIsDark();
  const { recovering, splits, next } = forecast(muscles, now);
  const nights = midnights(now);
  return (
    <section className="card forecast" aria-labelledby="forecast-title">
      <SectionTitle
        title="Recovery forecast"
        id="forecast-title"
        detail="Next 48 hours"
      />
      {next && (
        <p className="forecast-next">
          Next up: <strong>{next.label}</strong>
          {next.at <= now
            ? " is ready now."
            : `, ready by ${hourLabel(next.at, now)}.`}
        </p>
      )}
      {splits.length > 0 && (
        <div className="forecast-splits">
          {splits.map((s) => (
            <button
              key={s.id}
              type="button"
              className={s.id === next?.id ? "next" : ""}
              aria-label={`Plan ${s.label}: ${s.members.map((m) => m.name).join(", ")}. ${readyBy(s.at, now)}.`}
              onClick={() =>
                onPlan(
                  s.members.map((m) => m._id),
                  s.label,
                )
              }
            >
              <strong>{s.label}</strong>
              <span>{readyBy(s.at, now)}</span>
            </button>
          ))}
        </div>
      )}
      {recovering.length ? (
        <ul className="forecast-rows">
          <li className="forecast-axis" aria-hidden>
            <span />
            <span className="forecast-track">
              {nights.map((t) => (
                <span key={t} style={{ left: `${pct(t - now)}%` }}>
                  {new Date(t).toLocaleDateString([], { weekday: "short" })}
                </span>
              ))}
            </span>
            <span />
          </li>
          {recovering.map(({ muscle, at }) => (
            <li key={muscle._id}>
              <span className="capitalize">{muscle.name}</span>
              <span className="forecast-track" aria-hidden>
                {nights.map((t) => (
                  <i key={t} style={{ left: `${pct(t - now)}%` }} />
                ))}
                <b
                  className={at - now > FORECAST_MS ? "beyond" : ""}
                  style={barStyle(muscle, at, now, dark)}
                />
              </span>
              <span className="muted small">{hourLabel(at, now)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">Every muscle is recovered.</p>
      )}
    </section>
  );
}
