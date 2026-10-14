"use client";
import { useQuery } from "convex/react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  CalendarRange,
  Footprints,
  Moon,
  type LucideIcon,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { dayKey } from "@/lib/insights";
import { VOLUME_LOW } from "@/lib/volume";
import { SETS_PER_SESSION, type PlanDay } from "@/lib/week-plan";
import { deviceTimeZone } from "./coach";
import { SectionTitle, timeLabel } from "./ui";

const SPLIT: Record<
  NonNullable<PlanDay["split"]>,
  { label: string; icon: LucideIcon }
> = {
  push: { label: "Push", icon: ArrowUpFromLine },
  pull: { label: "Pull", icon: ArrowDownToLine },
  legs: { label: "Legs", icon: Footprints },
};

function dayLabel(plan: PlanDay, today: string, tomorrow: string) {
  if (plan.day === today) return "Today";
  if (plan.day === tomorrow) return "Tomorrow";
  return new Date(plan.at).toLocaleDateString([], { weekday: "long" });
}

// A push/pull/legs plan for the rest of the week: each day trains the split
// with the biggest gap to 10 sets whose muscles are off cooldown by 6 PM.
export function WeekPlanCard({
  muscles,
  now,
  onStart,
}: {
  muscles: { _id: Id<"muscles">; name: string }[];
  now: number;
  onStart: (ids: Id<"muscles">[], label: string) => void;
}) {
  const plan = useQuery(api.plan.week, { timeZone: deviceTimeZone() });
  if (!plan || plan.total === 0) return null;
  const today = dayKey(new Date(now));
  const next = new Date(now);
  next.setDate(next.getDate() + 1);
  const tomorrow = dayKey(next);
  const short = muscles
    .map((m) => ({ ...m, sets: plan.projected[m._id] ?? 0 }))
    .filter((m) => m.sets < VOLUME_LOW);

  return (
    <section className="card plan-card" aria-labelledby="plan-title">
      <SectionTitle
        id="plan-title"
        title="Rest of the week"
        detail={`Push, pull or legs each day, only once those muscles are off cooldown. Assumes a 6 PM session of about ${SETS_PER_SESSION} working sets per muscle.`}
        action={
          <span className="icon-tile green">
            <CalendarRange size={22} />
          </span>
        }
      />
      {plan.days.length === 0 ? (
        <p className="small muted plan-done">
          This week&apos;s sessions are behind you. A new plan starts Monday.
        </p>
      ) : (
        <>
          <p className="small plan-summary">
            <strong>{plan.onTarget}</strong> of {plan.total}{" "}
            {plan.total === 1 ? "muscle reaches" : "muscles reach"} {VOLUME_LOW}{" "}
            sets by Sunday with this plan
          </p>
          <ol className="plan-days">
            {plan.days.map((d) => {
              const split = d.split ? SPLIT[d.split] : null;
              const Icon = split?.icon ?? Moon;
              const label = dayLabel(d, today, tomorrow);
              return (
                <li key={d.day} className={d.split ?? "rest"}>
                  <span className="plan-when">
                    <strong>{label}</strong>
                    {split && (
                      <span className="small muted">{timeLabel(d.at)}</span>
                    )}
                  </span>
                  <span className="plan-icon" aria-hidden>
                    <Icon size={18} />
                  </span>
                  <span className="plan-what">
                    {split ? (
                      <>
                        <strong>{split.label}</strong>
                        <span className="small muted capitalize">
                          {d.muscles.map((m) => m.name).join(", ")}
                        </span>
                      </>
                    ) : (
                      <>
                        <strong>Rest</strong>
                        <span className="small muted">
                          {d.rest === "on-target"
                            ? `Every muscle is at ${VOLUME_LOW}+ sets`
                            : "Nothing that needs sets is off cooldown"}
                        </span>
                      </>
                    )}
                  </span>
                  {split && d.day === today && (
                    <button
                      type="button"
                      className="plan-start"
                      aria-label={`Select ${split.label.toLowerCase()} muscles for today's workout`}
                      onClick={() =>
                        onStart(
                          d.muscles.map((m) => m.id as Id<"muscles">),
                          split.label,
                        )
                      }
                    >
                      Select
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
          {short.length > 0 && (
            <p className="small muted plan-short">
              Still under {VOLUME_LOW} by Sunday:{" "}
              <span className="capitalize">
                {short.map((m) => `${m.name} ${m.sets}`).join(", ")}
              </span>
            </p>
          )}
        </>
      )}
    </section>
  );
}
