"use client";
import { useQuery } from "convex/react";
import {
  Beef,
  Coffee,
  Droplets,
  Dumbbell,
  Flame,
  Moon,
  Sunset,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import { isClear, summarize, type FactorId, type Finding } from "@/lib/drivers";
import { Progress, SectionTitle } from "./ui";

const DAYS = 90;
const MIN_DAYS = 10;
const SHOWN = 4;
const ICONS: Record<FactorId, LucideIcon> = {
  sleepHours: Moon,
  waterMl: Droplets,
  proteinG: Beef,
  kcal: Flame,
  caffeineMg: Coffee,
  lateCaffeineMg: Sunset,
  trained: Dumbbell,
};
type Outcome = Finding["outcome"];

// Which logged habits go with better or worse mood and energy, from the
// user's own last 90 days. Correlation only, and the copy says so.
export function DriversCard() {
  const data = useQuery(api.drivers.list, { days: DAYS });
  const [outcome, setOutcome] = useState<Outcome>("energy");
  const [all, setAll] = useState(false);
  if (!data) return null;

  const matching = data.findings.filter((f) => f.outcome === outcome);
  const clear = matching.filter(isClear);
  const shown = all ? matching : clear.slice(0, SHOWN);
  const hidden = matching.length - shown.length;

  return (
    <section className="card drivers-card" aria-labelledby="drivers-title">
      <SectionTitle
        id="drivers-title"
        title={`What goes with your ${outcome}`}
        detail={`From ${data.checkInDays} check-ins in the last ${data.days} days.`}
        action={
          <span className="icon-tile green">
            <TrendingUp size={22} />
          </span>
        }
      />
      {data.needed > 0 ? (
        <div className="drivers-empty">
          <Progress
            value={data.checkInDays / MIN_DAYS}
            label="Check-ins toward your first patterns"
            tone="green"
          />
          <p className="small muted">
            Log mood and energy on {data.needed} more{" "}
            {data.needed === 1 ? "day" : "days"} to see which habits go with
            your better days.
          </p>
        </div>
      ) : (
        <>
          <div
            className="segmented drivers-outcome"
            role="group"
            aria-label="Compare with"
          >
            {(["energy", "mood"] as const).map((o) => (
              <button
                key={o}
                type="button"
                aria-pressed={outcome === o}
                onClick={() => {
                  setOutcome(o);
                  setAll(false);
                }}
              >
                {o === "energy" ? "Energy" : "Mood"}
              </button>
            ))}
          </div>
          {shown.length ? (
            <>
              <p className="small muted drivers-legend" aria-hidden>
                <span className="drivers-dot high" /> With the habit
                <span className="drivers-dot low" /> Other days · on a 1–5 scale
              </p>
              <ul className="drivers-list">
                {shown.map((f) => (
                  <DriverRow key={`${f.factor}-${f.lag}`} finding={f} />
                ))}
              </ul>
            </>
          ) : (
            <p className="small muted drivers-none">
              {matching.length
                ? `No habit moves your ${outcome} by much yet.`
                : `Not enough varied days to compare with your ${outcome} yet.`}
            </p>
          )}
          {(hidden > 0 || all) && matching.length > clear.length && (
            <button
              type="button"
              className="text-button"
              aria-expanded={all}
              onClick={() => setAll(!all)}
            >
              {all ? "Show clear patterns only" : `Show all ${matching.length}`}
            </button>
          )}
        </>
      )}
      <p className="small muted drivers-note">
        Patterns in your own logs, not proof of cause.
      </p>
    </section>
  );
}

function DriverRow({ finding }: { finding: Finding }) {
  const Icon = ICONS[finding.factor];
  const better = finding.highMean >= finding.lowMean;
  const pos = (v: number) => `${((v - 1) / 4) * 100}%`;
  const [from, to] = [finding.lowMean, finding.highMean].sort((a, b) => a - b);
  return (
    <li className={better ? "up" : "down"}>
      <Icon size={20} aria-hidden className="drivers-icon" />
      <div>
        <p>{summarize(finding)}</p>
        {/* Both averages on the 1–5 scale; the sentence above carries the numbers. */}
        <div className="drivers-scale" aria-hidden>
          <span
            className="drivers-span"
            style={{
              left: pos(from),
              width: `calc(${pos(to)} - ${pos(from)})`,
            }}
          />
          <span
            className="drivers-dot low"
            style={{ left: pos(finding.lowMean) }}
          />
          <span
            className="drivers-dot high"
            style={{ left: pos(finding.highMean) }}
          />
        </div>
        <span className="small muted">
          {grade(finding)} · {finding.n} days
          {finding.confidence === "early" ? " · early" : ""}
        </span>
      </div>
    </li>
  );
}

function grade(finding: Finding) {
  const gap =
    Math.round(finding.highMean * 10) - Math.round(finding.lowMean * 10);
  if (!gap) return "No difference";
  const level = !isClear(finding)
    ? "Uncertain"
    : finding.strength === "strong"
      ? "Strong"
      : "Clear";
  return `${level} ${gap > 0 ? "lift" : "dip"}`;
}
