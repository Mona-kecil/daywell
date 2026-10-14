"use client";
import {
  useMemo,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { useQuery } from "convex/react";
import {
  Droplets,
  Dumbbell,
  Flame,
  Moon,
  Scale,
  Sparkles,
  Table2,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import {
  HISTORY_DAYS,
  RANGES,
  binBody,
  binDays,
  bodySummary,
  bucketDays,
  dayKey,
  dayWindow,
  summarize,
  type Bin,
  type BodyCheckin,
  type InsightsInput,
  type RangeId,
} from "@/lib/insights";
import { SectionTitle } from "./ui";
import { LineChart } from "./line-chart";
import { ConsistencyCalendar } from "./consistency";
import { DriversCard } from "./drivers";
import { YearPixels } from "./pixels";
import { EatingWindowCard } from "./eating";
import { Achievements, WeeklyReview } from "./review";
import { ProgressPhotos } from "./progress-photos";
import {
  BodyModel,
  FREQUENCY_HUE,
  mix,
  muscleKey,
  PALETTE,
  type MuscleKey,
  type MuscleState,
} from "./body3d";

export function Insights({ now }: { now: number }) {
  const today = dayKey(new Date(now));
  // Recompute the period only when the calendar day changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const period = useMemo(() => dayWindow(new Date(now), HISTORY_DAYS), [today]);
  const data = useQuery(api.insights.range, {
    startMs: period.startMs,
    endMs: period.endMs,
  });
  const checkins = useQuery(api.checkins.range, {
    fromDay: period.days[0].key,
    toDay: period.days[period.days.length - 1].key,
  });
  if (!data || !checkins)
    return (
      <div className="card" role="status">
        Loading insights…
      </div>
    );
  return (
    <>
      <InsightsView
        data={data}
        period={period}
        checkins={checkins}
        patterns={
          <>
            <DriversCard />
            <YearPixels now={now} />
          </>
        }
      >
        <WeeklyReview now={now} />
      </InsightsView>
      <Achievements now={now} />
      <ProgressPhotos now={now} />
    </>
  );
}

const litres = (ml: number) =>
  `${(ml / 1000).toLocaleString(undefined, { maximumFractionDigits: 1, minimumFractionDigits: 1 })} L`;
const whole = (n: number) =>
  n.toLocaleString(undefined, { maximumFractionDigits: 0 });
const oneDp = (n: number) =>
  n.toLocaleString(undefined, { maximumFractionDigits: 1 });
const signedKg = (n: number) =>
  `${n > 0 ? "+" : n < 0 ? "−" : "±"}${oneDp(Math.abs(n))} kg`;

function binLabel(bin: Bin) {
  const start = new Date(bin.startMs);
  return bin.days.length > 1
    ? `Week of ${start.toLocaleDateString([], { month: "short", day: "numeric" })}`
    : start.toLocaleDateString([], {
        weekday: "short",
        month: "short",
        day: "numeric",
      });
}

function tickLabel(bin: Bin, count: number) {
  const start = new Date(bin.startMs);
  return count <= 7
    ? start.toLocaleDateString([], { weekday: "short" })
    : start.toLocaleDateString([], { month: "short", day: "numeric" });
}

// Ticks counted back from the newest bin, so "today" is always labelled.
function tickIndexes(count: number) {
  const every = count <= 7 ? 1 : count <= 13 ? 4 : 7;
  const out: number[] = [];
  for (let i = count - 1; i >= 0; i -= every) out.unshift(i);
  return out;
}

function niceMax(value: number) {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step =
    [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((s) => s * magnitude >= value) ??
    10;
  return step * magnitude;
}

type Series = {
  id: string;
  label: string;
  value: (bin: Bin) => number | null;
};

function useScrub(count: number) {
  const [active, setActive] = useState<number | null>(null);
  const pick = (e: PointerEvent<HTMLElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const i = Math.floor(((e.clientX - rect.left) / rect.width) * count);
    setActive(Math.min(count - 1, Math.max(0, i)));
  };
  const handlers = {
    onPointerDown: pick,
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      if (e.pointerType === "mouse" || e.buttons) pick(e);
    },
    onPointerLeave: (e: PointerEvent<HTMLElement>) => {
      if (e.pointerType === "mouse") setActive(null);
    },
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      const step = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
      if (step) {
        e.preventDefault();
        setActive((i) => Math.min(count - 1, Math.max(0, (i ?? count) + step)));
      } else if (e.key === "Escape") setActive(null);
    },
    onBlur: () => setActive(null),
  };
  return { active, handlers };
}

function BarChart({
  title,
  bins,
  series,
  summary,
  describe,
  unit,
  format,
  goal,
}: {
  title: string;
  bins: Bin[];
  series: Series[];
  summary: string;
  describe: (bin: Bin) => string;
  unit: string;
  format: (value: number) => string;
  goal?: { value: number; label: string };
}) {
  const { active, handlers } = useScrub(bins.length);
  const totals = bins.map((b) =>
    series.reduce((sum, s) => sum + (s.value(b) ?? 0), 0),
  );
  const max = niceMax(Math.max(...totals, goal?.value ?? 0));
  const ticks = [0, max / 2, max];
  const pct = (v: number) => `${(v / max) * 100}%`;
  return (
    <section className="card chart">
      <div className="chart-head">
        <h3>{title}</h3>
        <p className="chart-readout" aria-live="polite">
          {active === null ? (
            summary
          ) : (
            <>
              <strong>{binLabel(bins[active])}</strong> ·{" "}
              {describe(bins[active])}
            </>
          )}
        </p>
      </div>
      {series.length > 1 && (
        <ul className="chart-legend">
          {series.map((s) => (
            <li key={s.id}>
              <i className={`swatch ${s.id}`} />
              {s.label}
            </li>
          ))}
        </ul>
      )}
      <div className="chart-body">
        <div className="chart-y" aria-hidden>
          {ticks.map((t) => (
            <span key={t} style={{ bottom: pct(t) }}>
              {format(t)}
            </span>
          ))}
        </div>
        <div
          className="chart-plot"
          tabIndex={0}
          role="group"
          aria-label={`${title} in ${unit}. Use arrow keys to read each ${bins[0]?.days.length > 1 ? "week" : "day"}.`}
          {...handlers}
        >
          {ticks.map((t) => (
            <i key={t} className="chart-grid" style={{ bottom: pct(t) }} />
          ))}
          {goal && (
            <div className="chart-goal" style={{ bottom: pct(goal.value) }}>
              <span>{goal.label}</span>
            </div>
          )}
          <div
            className="chart-cols"
            style={{ gridTemplateColumns: `repeat(${bins.length}, 1fr)` }}
          >
            {bins.map((bin, i) => (
              <div
                key={bin.key}
                className={`chart-col${active === i ? " active" : ""}${active !== null && active !== i ? " dim" : ""}`}
              >
                <div className="chart-stack" style={{ height: pct(totals[i]) }}>
                  {[...series].reverse().map((s) => {
                    const v = s.value(bin) ?? 0;
                    return v > 0 ? (
                      <span
                        key={s.id}
                        className={`seg ${s.id}`}
                        style={{ flexGrow: v }}
                      />
                    ) : null;
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div
        className="chart-x"
        aria-hidden
        style={{ gridTemplateColumns: `repeat(${bins.length}, 1fr)` }}
      >
        {tickIndexes(bins.length).map((i) => (
          <span key={i} style={{ gridColumn: i + 1 }}>
            {tickLabel(bins[i], bins.length)}
          </span>
        ))}
      </div>
    </section>
  );
}

function TrainingMap({
  bins,
  muscles,
}: {
  bins: Bin[];
  muscles: InsightsInput["muscles"];
}) {
  const [active, setActive] = useState<{ muscle: number; bin: number } | null>(
    null,
  );
  const weekly = bins[0]?.days.length > 1;
  const level = (count: number) =>
    count === 0 ? 0 : weekly ? Math.min(3, count) : 3;
  const describe = (m: number, b: number) => {
    const count = bins[b].trained.get(muscles[m]._id) ?? 0;
    return weekly
      ? `${count} ${count === 1 ? "day" : "days"}`
      : count
        ? "Trained"
        : "Rest";
  };
  return (
    <section className="card chart">
      <div className="chart-head">
        <h3>Training map</h3>
        <p className="chart-readout" aria-live="polite">
          {active ? (
            <>
              <strong className="capitalize">
                {muscles[active.muscle].name}
              </strong>{" "}
              · {binLabel(bins[active.bin])} ·{" "}
              {describe(active.muscle, active.bin)}
            </>
          ) : weekly ? (
            "Days trained per week"
          ) : (
            "Muscles trained each day"
          )}
        </p>
      </div>
      <div
        className="heatmap"
        tabIndex={0}
        role="group"
        aria-label={`Training map. Use arrow keys to read each muscle by ${weekly ? "week" : "day"}.`}
        style={{
          gridTemplateColumns: `minmax(64px, auto) repeat(${bins.length}, 1fr) 30px`,
        }}
        onPointerLeave={(e) => {
          if (e.pointerType === "mouse") setActive(null);
        }}
        onKeyDown={(e) => {
          const move = {
            ArrowLeft: [0, -1],
            ArrowRight: [0, 1],
            ArrowUp: [-1, 0],
            ArrowDown: [1, 0],
          }[e.key];
          if (move) {
            e.preventDefault();
            setActive((a) => ({
              muscle: Math.min(
                muscles.length - 1,
                Math.max(0, (a?.muscle ?? 0) + (a ? move[0] : 0)),
              ),
              bin: Math.min(
                bins.length - 1,
                Math.max(0, (a?.bin ?? bins.length - 1) + (a ? move[1] : 0)),
              ),
            }));
          } else if (e.key === "Escape") setActive(null);
        }}
        onBlur={() => setActive(null)}
      >
        {muscles.map((m, mi) => {
          const total = bins.reduce(
            (sum, b) => sum + (b.trained.get(m._id) ?? 0),
            0,
          );
          return [
            <span key={`${m._id}-name`} className="heat-name capitalize">
              {m.name}
            </span>,
            ...bins.map((b, bi) => (
              <i
                key={`${m._id}-${b.key}`}
                className={`heat-cell l${level(b.trained.get(m._id) ?? 0)}${active?.muscle === mi && active.bin === bi ? " active" : ""}`}
                onPointerEnter={() => setActive({ muscle: mi, bin: bi })}
                onPointerDown={() => setActive({ muscle: mi, bin: bi })}
              />
            )),
            <span key={`${m._id}-total`} className="heat-total">
              {total || "–"}
            </span>,
          ];
        })}
      </div>
      <div className="heat-legend" aria-hidden>
        {weekly ? (
          <>
            <span>Less</span>
            {[0, 1, 2, 3].map((l) => (
              <i key={l} className={`heat-cell l${l}`} />
            ))}
            <span>More</span>
          </>
        ) : (
          <>
            <i className="heat-cell l3" />
            <span>Trained</span>
          </>
        )}
        <span className="heat-legend-total">Days in range</span>
      </div>
    </section>
  );
}

function TrainingBody({
  bins,
  muscles,
}: {
  bins: Bin[];
  muscles: InsightsInput["muscles"];
}) {
  const counts = new Map<MuscleKey, number>();
  for (const m of muscles) {
    const key = muscleKey(m.name);
    if (key)
      counts.set(
        key,
        bins.reduce((sum, b) => sum + (b.trained.get(m._id) ?? 0), 0),
      );
  }
  const max = Math.max(1, ...counts.values());
  const states = Object.fromEntries(
    [...counts].map(([key, n]): [MuscleKey, MuscleState] => [
      key,
      {
        kind: "ready",
        fraction: 1,
        label: `${n} ${n === 1 ? "day" : "days"} trained`,
      },
    ]),
  );
  return (
    <section className="card chart">
      <div className="chart-head">
        <h3>Where you trained</h3>
        <p className="chart-readout">Days each muscle was trained</p>
      </div>
      <BodyModel
        states={states}
        height={360}
        colorOf={(key, dark) => {
          const n = counts.get(key) ?? 0;
          const base = dark ? PALETTE.dark.never : PALETTE.light.never;
          return n
            ? mix(
                base,
                FREQUENCY_HUE[dark ? "dark" : "light"],
                0.3 + (0.7 * n) / max,
              )
            : base;
        }}
        legend={
          <>
            <span>0</span>
            <i className="frequency-ramp" />
            <span>
              {max} {max === 1 ? "day" : "days"}
            </span>
          </>
        }
      />
    </section>
  );
}

function DataTable({
  bins,
  muscles,
  byDay,
}: {
  bins: Bin[];
  muscles: InsightsInput["muscles"];
  byDay: Map<string, BodyCheckin>;
}) {
  const body = (b: Bin, field: "sleepHours" | "weightKg", unit: string) => {
    const v = binBody(b, byDay, field);
    return v === null ? "–" : `${oneDp(v)} ${unit}`;
  };
  const name = new Map(muscles.map((m) => [m._id, m.name]));
  const weekly = bins[0]?.days.length > 1;
  return (
    <section className="card table-card">
      <div className="table-scroll">
        <table className="data-table">
          <caption className="muted small">
            {weekly ? "Weekly averages over logged days" : "Daily totals"}
          </caption>
          <thead>
            <tr>
              <th scope="col">{weekly ? "Week" : "Day"}</th>
              <th scope="col">Water</th>
              <th scope="col">kcal</th>
              <th scope="col">Protein</th>
              <th scope="col">Carbs</th>
              <th scope="col">Fat</th>
              <th scope="col">Sleep</th>
              <th scope="col">Weight</th>
              <th scope="col">Trained</th>
            </tr>
          </thead>
          <tbody>
            {[...bins].reverse().map((b) => (
              <tr key={b.key}>
                <th scope="row">{binLabel(b)}</th>
                <td>{b.waterMl === null ? "–" : litres(b.waterMl)}</td>
                <td>{b.macros ? whole(b.macros.kcal) : "–"}</td>
                <td>{b.macros ? `${whole(b.macros.protein)} g` : "–"}</td>
                <td>{b.macros ? `${whole(b.macros.carbs)} g` : "–"}</td>
                <td>{b.macros ? `${whole(b.macros.fat)} g` : "–"}</td>
                <td>{body(b, "sleepHours", "h")}</td>
                <td>{body(b, "weightKg", "kg")}</td>
                <td className="capitalize">
                  {[...b.trained.keys()]
                    .map((id) => name.get(id) ?? "Muscle")
                    .join(", ") || "–"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function InsightsView({
  data,
  period,
  checkins = [],
  children,
  patterns,
}: {
  data: InsightsInput;
  period: ReturnType<typeof dayWindow>;
  checkins?: BodyCheckin[];
  children?: ReactNode;
  patterns?: ReactNode;
}) {
  const [range, setRange] = useState<RangeId>("7d");
  const [table, setTable] = useState(false);
  const history = useMemo(() => bucketDays(period.days, data), [period, data]);
  const { days: count, binDays: size } = RANGES[range];
  const days = history.slice(-count);
  const bins = binDays(days, size);
  const stats = summarize(days, history, data);
  const body = bodySummary(days, checkins);
  const byDay = new Map(checkins.map((c) => [c.day, c]));
  const dayStart = new Map(days.map((d) => [d.key, d.startMs]));
  const weightPoints = checkins.flatMap((c) =>
    c.weightKg !== undefined && dayStart.has(c.day)
      ? [{ key: c.day, t: dayStart.get(c.day)!, v: c.weightKg }]
      : [],
  );
  const per = size > 1 ? "/day avg" : "";

  const notes: string[] = [];
  if (stats.untrained.length && stats.untrained.length < data.muscles.length)
    notes.push(
      `Not trained in this range: ${stats.untrained.map((m) => m.name).join(", ")}.`,
    );
  if (stats.waterDays)
    notes.push(
      `Water goal reached on ${stats.goalDays} of ${days.length} days.`,
    );
  if (stats.avgProtein !== null)
    notes.push(
      `Protein averaged ${whole(stats.avgProtein)} g across ${stats.mealDays} logged ${stats.mealDays === 1 ? "day" : "days"}.`,
    );
  const { restedMood, trainedEnergy } = body;
  if (restedMood && Math.abs(restedMood.rested - restedMood.short) >= 0.3)
    notes.push(
      `Mood averaged ${oneDp(restedMood.rested)}/5 after 7 h+ of sleep, ${oneDp(restedMood.short)}/5 after shorter nights.`,
    );
  if (
    trainedEnergy &&
    Math.abs(trainedEnergy.trained - trainedEnergy.rest) >= 0.3
  )
    notes.push(
      `Energy averaged ${oneDp(trainedEnergy.trained)}/5 on training days, ${oneDp(trainedEnergy.rest)}/5 on rest days.`,
    );

  return (
    <>
      <section className="page-heading">
        <div className="eyebrow">TRENDS</div>
        <h1>Insights.</h1>
        <p className="muted">
          How your water, meals, training, and body add up.
        </p>
      </section>
      {children}
      <div className="insights-filters">
        <div className="segmented" role="group" aria-label="Date range">
          {(Object.keys(RANGES) as RangeId[]).map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={range === id}
              onClick={() => setRange(id)}
            >
              {RANGES[id].label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="text-button"
          aria-pressed={table}
          onClick={() => setTable(!table)}
        >
          <Table2 size={16} />
          {table ? "Charts" : "Table"}
        </button>
      </div>
      <div className="stat-grid">
        <div className="stat">
          <Droplets size={18} className="blue-text" />
          <strong>
            {stats.waterStreak}
            <small> {stats.waterStreak === 1 ? "day" : "days"}</small>
          </strong>
          <span>Water goal streak</span>
        </div>
        <div className="stat">
          <Droplets size={18} className="blue-text" />
          <strong>
            {stats.avgWaterMl === null ? "–" : litres(stats.avgWaterMl)}
          </strong>
          <span>Avg per logged day</span>
        </div>
        <div className="stat">
          <Flame size={18} className="amber-text" />
          <strong>
            {stats.avgKcal === null ? "–" : whole(stats.avgKcal)}
            <small> kcal</small>
          </strong>
          <span>Avg per logged day</span>
        </div>
        <div className="stat">
          <Dumbbell size={18} className="green-text" />
          <strong>
            {stats.trainingDays}
            <small> / {days.length}</small>
          </strong>
          <span>
            Days trained
            {stats.trainingStreakWeeks > 1 &&
              ` · ${stats.trainingStreakWeeks}-week streak`}
          </span>
        </div>
        {body.avgSleep !== null && (
          <div className="stat">
            <Moon size={18} className="blue-text" />
            <strong>
              {oneDp(body.avgSleep)}
              <small> h</small>
            </strong>
            <span>Avg sleep</span>
          </div>
        )}
        {body.latestWeight !== null && (
          <div className="stat">
            <Scale size={18} className="green-text" />
            <strong>
              {oneDp(body.latestWeight)}
              <small> kg</small>
            </strong>
            <span>
              Latest weight
              {body.weightChange !== null &&
                ` · ${signedKg(body.weightChange)}`}
            </span>
          </div>
        )}
      </div>
      {notes.length > 0 && (
        <section className="card insight-notes">
          <SectionTitle
            title="Worth noticing"
            action={<Sparkles size={20} />}
          />
          <ul>
            {notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </section>
      )}
      {patterns}
      <ConsistencyCalendar
        days={history}
        waterGoal={data.waterGoal}
        checkinDays={new Set(checkins.map((c) => c.day))}
      />
      <EatingWindowCard
        meals={data.meals}
        days={period.days}
        today={period.days.at(-1)!.key}
      />
      {table ? (
        <DataTable bins={bins} muscles={data.muscles} byDay={byDay} />
      ) : (
        <>
          <BarChart
            title="Water"
            unit="litres"
            bins={bins}
            series={[{ id: "water", label: "Water", value: (b) => b.waterMl }]}
            summary={
              stats.avgWaterMl === null
                ? "No water logged yet"
                : `Avg ${litres(stats.avgWaterMl)}${per ? " per day" : ""}`
            }
            describe={(b) =>
              b.waterMl === null
                ? "Nothing logged"
                : `${litres(b.waterMl)}${per}`
            }
            format={(v) => (v === 0 ? "0" : `${v / 1000}L`)}
            goal={{
              value: data.waterGoal,
              label: `Goal ${litres(data.waterGoal)}`,
            }}
          />
          <BarChart
            title="Calories"
            unit="kcal"
            bins={bins}
            series={[
              {
                id: "kcal",
                label: "Calories",
                value: (b) => b.macros?.kcal ?? null,
              },
            ]}
            summary={
              stats.avgKcal === null
                ? "No meals analysed yet"
                : `Avg ${whole(stats.avgKcal)} kcal`
            }
            describe={(b) =>
              b.macros ? `${whole(b.macros.kcal)} kcal${per}` : "Nothing logged"
            }
            format={(v) => (v >= 1000 ? `${v / 1000}k` : whole(v))}
          />
          <BarChart
            title="Macros"
            unit="grams"
            bins={bins}
            series={[
              {
                id: "protein",
                label: "Protein",
                value: (b) => b.macros?.protein ?? null,
              },
              { id: "fat", label: "Fat", value: (b) => b.macros?.fat ?? null },
              {
                id: "carbs",
                label: "Carbs",
                value: (b) => b.macros?.carbs ?? null,
              },
            ]}
            summary="Grams per day"
            describe={(b) =>
              b.macros
                ? `P ${whole(b.macros.protein)} · F ${whole(b.macros.fat)} · C ${whole(b.macros.carbs)} g`
                : "Nothing logged"
            }
            format={(v) => `${whole(v)}g`}
          />
          {body.avgSleep !== null && (
            <BarChart
              title="Sleep"
              unit="hours"
              bins={bins}
              series={[
                {
                  id: "sleep",
                  label: "Sleep",
                  value: (b) => binBody(b, byDay, "sleepHours"),
                },
              ]}
              summary={`Avg ${oneDp(body.avgSleep)} h a night`}
              describe={(b) => {
                const h = binBody(b, byDay, "sleepHours");
                return h === null ? "Not logged" : `${oneDp(h)} h${per}`;
              }}
              format={(v) => `${v}h`}
              goal={{ value: 8, label: "8 h" }}
            />
          )}
          {weightPoints.length >= 2 && (
            <LineChart
              className="card chart"
              title={<h3>Weight</h3>}
              points={weightPoints}
              format={oneDp}
              summary={`${oneDp(body.latestWeight!)} kg · ${signedKg(body.weightChange!)} in this range`}
              describe={(p) =>
                `${new Date(p.t).toLocaleDateString([], { month: "short", day: "numeric" })} · ${oneDp(p.v)} kg`
              }
              label={`Weight went from ${oneDp(weightPoints[0].v)} to ${oneDp(body.latestWeight!)} kilograms.`}
            />
          )}
          <TrainingBody bins={bins} muscles={data.muscles} />
          <TrainingMap bins={bins} muscles={data.muscles} />
        </>
      )}
    </>
  );
}
