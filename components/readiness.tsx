"use client";
import { useQuery } from "convex/react";
import { Gauge } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Readiness } from "@/lib/readiness";
import { deviceTimeZone } from "./coach";
import { settledNow, useLatest } from "./review";
import { SectionTitle, scrollMotion } from "./ui";

type Factor = Readiness["components"][number];

const BANDS = {
  push: {
    label: "Ready to push",
    tone: "green",
    advice: "A good day for a heavy session or a PR attempt.",
  },
  steady: {
    label: "Train steady",
    tone: "amber",
    advice: "Train as planned and skip the max-effort sets.",
  },
  easy: {
    label: "Take it easy",
    tone: "blue",
    advice: "Go light: a walk, mobility or a stretch.",
  },
} as const;

const hours = (h = 0) =>
  `${h.toLocaleString(undefined, { maximumFractionDigits: 1 })} h`;

// A factor below 50 caps the band at "steady" even when the average is high,
// so a steady day names its weakest factor (factors arrive weakest first).
const HELD_BACK: Record<Factor["key"], string> = {
  load: "Your training load is well above your usual week",
  sleep: "Last night was short",
  sleepTrend: "You've slept less than usual lately",
  feel: "You're running low today",
  soreness: "Several muscle groups are still sore",
};
function adviceFor(data: Readiness) {
  if (!data.band) return "";
  const weakest = data.components[0];
  if (data.band === "steady" && weakest && weakest.score < 50)
    return `${HELD_BACK[weakest.key]}, so train as planned and skip the max-effort sets.`;
  return BANDS[data.band].advice;
}

const FACTORS: Record<
  Factor["key"],
  { label: string; detail: (d: Factor["detail"]) => string }
> = {
  sleep: { label: "Sleep", detail: (d) => `${hours(d.sleepHours)} last night` },
  sleepTrend: {
    label: "Sleep trend",
    detail: (d) =>
      `${hours(d.recentSleep)} lately, ${hours(d.baselineSleep)} usual`,
  },
  feel: {
    label: "How you feel",
    detail: (d) =>
      [d.energy && `Energy ${d.energy}/5`, d.mood && `Mood ${d.mood}/5`]
        .filter(Boolean)
        .join(" · "),
  },
  soreness: {
    label: "Soreness",
    detail: (d) =>
      d.sore
        ? `${d.sore} of ${d.total} muscle groups sore`
        : "No sore muscle groups",
  },
  load: { label: "Training load", detail: (d) => `${d.acwr}× your usual week` },
};

// The check-in card on Today carries id="checkin".
function focusCheckin(selector: string) {
  const field = document.querySelector<HTMLElement>(`#checkin ${selector}`);
  field?.scrollIntoView({ behavior: scrollMotion(), block: "center" });
  field?.focus({ preventScroll: true });
}

// A half-circle dial; the score is in text beside it.
function Dial({ score, tone }: { score: number; tone: string }) {
  const r = 52;
  const arc = Math.PI * r;
  return (
    <svg className={`readiness-dial ${tone}`} viewBox="0 0 120 66" aria-hidden>
      <path
        d="M8 60a52 52 0 0 1 104 0"
        className="dial-track"
        pathLength={arc}
      />
      <path
        d="M8 60a52 52 0 0 1 104 0"
        className="dial-arc"
        strokeDasharray={arc}
        strokeDashoffset={arc * (1 - score / 100)}
        pathLength={arc}
      />
    </svg>
  );
}

export function ReadinessCard({ now }: { now: number }) {
  const data = useLatest(
    useQuery(api.readiness.today, {
      now: settledNow(now),
      timeZone: deviceTimeZone(),
    }),
  );
  if (!data) return null;
  const band = data.band && BANDS[data.band];
  return (
    <section
      id="readiness"
      className="card readiness-card"
      aria-labelledby="readiness-title"
    >
      <SectionTitle
        title="Readiness"
        id="readiness-title"
        action={
          band ? (
            <span className={`pill ${band.tone}`}>{band.label}</span>
          ) : (
            <span className="icon-tile green">
              <Gauge size={22} />
            </span>
          )
        }
      />
      {data.score !== null && band ? (
        <>
          <div className="readiness-head">
            <div className="readiness-dial-wrap">
              <Dial score={data.score} tone={band.tone} />
              <p className="readiness-score">
                <strong>{data.score}</strong>
                <span className="muted">/100</span>
              </p>
            </div>
            <p>{adviceFor(data)}</p>
          </div>
          <ul className="readiness-factors">
            {data.components.map((c) => (
              <li key={c.key}>
                <span>{FACTORS[c.key].label}</span>
                <span className="muted small">
                  {FACTORS[c.key].detail(c.detail)}
                </span>
                <span className="readiness-bar" aria-hidden>
                  <span style={{ width: `${c.score}%` }} />
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="muted">
          {data.missing.length
            ? `Log ${[
                data.missing.includes("sleep") && "last night's sleep",
                data.missing.includes("feel") && "how you feel",
              ]
                .filter(Boolean)
                .join(" and ")} to see today's readiness.`
            : "Readiness needs two signals. Keep logging and it will appear."}
        </p>
      )}
      {data.missing.length > 0 && (
        <div className="readiness-missing">
          {data.missing.includes("sleep") && (
            <button
              type="button"
              className="soft-button"
              onClick={() => focusCheckin('input[name="sleep"]')}
            >
              Add sleep
            </button>
          )}
          {data.missing.includes("feel") && (
            <button
              type="button"
              className="soft-button"
              onClick={() => focusCheckin("button.mood")}
            >
              Add how you feel
            </button>
          )}
        </div>
      )}
      {data.score !== null && (
        <p className="muted small readiness-note">
          An estimate from your logs, not medical advice.
        </p>
      )}
    </section>
  );
}
