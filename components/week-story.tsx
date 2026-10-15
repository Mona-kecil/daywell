"use client";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  CalendarCheck,
  ChartSpline,
  Droplets,
  Dumbbell,
  Footprints,
  Moon,
  Pause,
  Play,
  Sparkles,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "@/convex/_generated/api";
import { minutesLabel } from "./cardio";

type Review = FunctionReturnType<typeof api.coach.weeklyReview>;
type Lift = FunctionReturnType<typeof api.trends.list>["lifts"][number];
type Slide = {
  key: string;
  icon: LucideIcon;
  eyebrow: string;
  big: ReactNode;
  text: ReactNode;
  extra?: ReactNode;
};

export const SLIDE_MS = 6000;
// A press held this long pauses the story instead of turning the page.
const HOLD_MS = 400;

const whole = (n: number) =>
  n.toLocaleString(undefined, { maximumFractionDigits: 0 });
const oneDp = (n: number) =>
  n.toLocaleString(undefined, { maximumFractionDigits: 1 });
const plural = (n: number, noun: string) =>
  `${whole(n)} ${noun}${n === 1 ? "" : "s"}`;
const civil = (day: string) =>
  new Date(`${day}T12:00:00`).toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });

export function storySlides(review: Review, lifts: Lift[]): Slide[] {
  const slides: Slide[] = [
    {
      key: "days",
      icon: CalendarCheck,
      eyebrow: `${civil(review.fromDay)} – ${civil(review.toDay)}`,
      big: `${review.daysLogged} of 7 days`,
      text:
        review.daysLogged === 7
          ? "You logged something every single day."
          : `You logged something on ${plural(review.daysLogged, "day")} this week.`,
      extra: (
        <span className="story-dots" aria-hidden>
          {Array.from({ length: 7 }, (_, i) => (
            <i key={i} className={i < review.daysLogged ? "on" : undefined} />
          ))}
        </span>
      ),
    },
    review.workouts
      ? {
          key: "training",
          icon: Dumbbell,
          eyebrow: "Training",
          big: plural(review.workouts, "workout"),
          text: `${plural(review.totalSets, "set")}${review.newPRs ? `, and ${plural(review.newPRs, "new personal record")}` : ""}.`,
        }
      : {
          key: "training",
          icon: Dumbbell,
          eyebrow: "Training",
          big: "A rest week",
          text: "No workouts logged, so every muscle has had time to recover.",
        },
  ];

  if (review.cardioSessions) {
    const active = review.cardioActiveMinutes ?? 0;
    const goal = review.cardioGoal ?? 150;
    slides.push({
      key: "cardio",
      icon: Footprints,
      eyebrow: "Cardio",
      big: `${whole(active)} active minutes`,
      text: `${plural(review.cardioSessions, "session")}, ${minutesLabel(review.cardioMinutes ?? 0)} in all. ${active >= goal ? `You hit the ${goal}-minute goal.` : `${whole(goal - active)} to go for ${goal}.`}`,
      extra: (
        <span className="story-bar" aria-hidden>
          <span style={{ width: `${Math.min(100, (active / goal) * 100)}%` }} />
        </span>
      ),
    });
  }

  const climbing = lifts
    .filter((l) => l.status === "climbing" && l.changePct !== null)
    .sort((a, b) => b.changePct! - a.changePct!);
  const stalled = lifts.filter((l) => l.status === "stalled");
  if (climbing.length || stalled.length) {
    const top = climbing[0];
    const latest = top?.points.at(-1)?.value;
    slides.push({
      key: "lifts",
      icon: ChartSpline,
      eyebrow: "Lifts",
      big: top
        ? `+${oneDp(top.changePct!)}% a week`
        : `${stalled.length} stalled`,
      text: top
        ? `${top.name} is climbing fastest${latest === undefined ? "" : top.unit === "reps" ? `, best set ${whole(latest)} reps` : `, estimated max ${oneDp(latest)} kg`}.`
        : `${stalled.map((l) => l.name).join(", ")} ${stalled.length === 1 ? "hasn't" : "haven't"} set a new best lately.`,
      extra:
        top && stalled.length ? (
          <span className="story-note">
            Stalled: {stalled.map((l) => l.name).join(", ")}. A new rep range
            can restart progress.
          </span>
        ) : undefined,
    });
  }

  const water = Math.min(100, review.waterGoalPercent);
  slides.push({
    key: "water",
    icon: Droplets,
    eyebrow: "Water",
    big: `${whole(review.avgWaterMl)} ml a day`,
    text: `${whole(review.waterGoalPercent)}% of your ${whole(review.waterGoalMl)} ml goal, on average.`,
    extra: (
      <span className="story-bar" aria-hidden>
        <span style={{ width: `${water}%` }} />
      </span>
    ),
  });
  if (review.avgSleepHours !== null)
    slides.push({
      key: "sleep",
      icon: Moon,
      eyebrow: "Sleep",
      big: `${oneDp(review.avgSleepHours)} h a night`,
      text: `Averaged over ${plural(review.sleepDays, "logged night")}.`,
    });
  slides.push({
    key: "end",
    icon: Sparkles,
    eyebrow: "That's your week",
    big: review.daysLogged >= 5 ? "Nicely done." : "Every log counts.",
    text: "Keep logging and next week's story writes itself.",
  });
  return slides;
}

// A tap-through story of the past seven days. Taps on the left go back, the
// rest go forward; holding pauses. Each page moves on by itself unless the
// reader prefers reduced motion.
export function WeekStory({
  review,
  now,
  onClose,
}: {
  review: Review;
  now: number;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const trends = useQuery(api.trends.list, {
    now: Math.ceil(now / 300_000) * 300_000,
  });
  const slides = storySlides(review, trends?.lifts ?? []);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [held, setHeld] = useState(false);
  const pressedAt = useRef(0);
  const pressing = useRef(false);
  // Set when a press was long enough to count as a hold, so the click that
  // follows it doesn't also turn the page. Keyboard clicks never set it.
  const wasHold = useRef(false);
  const [reduced] = useState(
    () =>
      typeof matchMedia === "function" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const i = Math.min(index, slides.length - 1);
  const slide = slides[i];
  const last = i === slides.length - 1;

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal?.();
  }, []);

  const go = (step: number) =>
    setIndex(Math.max(0, Math.min(slides.length - 1, i + step)));
  const tap = (step: number) => {
    if (wasHold.current) wasHold.current = false;
    else go(step);
  };
  const release = () => {
    if (pressing.current)
      wasHold.current = Date.now() - pressedAt.current > HOLD_MS;
    pressing.current = false;
    setHeld(false);
  };
  // A press that slides off the page or is cancelled is no tap to swallow.
  // Touch fires pointerleave after pointerup, which must keep the hold.
  const letGo = () => {
    if (pressing.current) wasHold.current = false;
    pressing.current = false;
    setHeld(false);
  };
  const close = () => {
    const dialog = ref.current;
    // Closing the dialog fires its close event, which calls onClose.
    if (dialog?.open && dialog.close) dialog.close();
    else onClose();
  };
  const Icon = slide.icon;

  return (
    <dialog
      ref={ref}
      className="story"
      aria-label="Your week"
      aria-roledescription="story"
      onClose={onClose}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") go(1);
        if (e.key === "ArrowLeft") go(-1);
      }}
    >
      <div className="story-progress" aria-hidden>
        {slides.map((s, k) => (
          <span
            key={s.key}
            className={k < i ? "done" : k === i ? "active" : undefined}
          >
            {k === i && (
              <span
                key={i}
                style={{
                  animationDuration: `${SLIDE_MS}ms`,
                  animationPlayState: paused || held ? "paused" : "running",
                }}
                onAnimationEnd={() => !last && !reduced && go(1)}
              />
            )}
          </span>
        ))}
      </div>
      <div className="story-bar-top">
        <span className="sr-only" aria-live="polite">
          Page {i + 1} of {slides.length}
        </span>
        {!reduced && (
          <button
            type="button"
            aria-label={paused ? "Play story" : "Pause story"}
            onClick={() => setPaused(!paused)}
          >
            {paused ? <Play size={20} /> : <Pause size={20} />}
          </button>
        )}
        <button type="button" aria-label="Close story" onClick={close}>
          <X size={22} />
        </button>
      </div>
      <div
        className="story-stage"
        onPointerDown={() => {
          pressedAt.current = Date.now();
          pressing.current = true;
          setHeld(true);
        }}
        onPointerUp={release}
        onPointerCancel={letGo}
        onPointerLeave={letGo}
      >
        <article key={slide.key} className="story-slide" aria-live="polite">
          <span className="story-icon">
            <Icon size={28} aria-hidden />
          </span>
          <p className="story-eyebrow">{slide.eyebrow}</p>
          <h2 className="story-big">{slide.big}</h2>
          <p className="story-text">{slide.text}</p>
          {slide.extra}
        </article>
        <button
          type="button"
          className="story-tap prev"
          aria-label="Previous page"
          disabled={i === 0}
          onClick={() => tap(-1)}
        />
        <button
          type="button"
          className="story-tap next"
          aria-label="Next page"
          disabled={last}
          onClick={() => tap(1)}
        />
      </div>
      {last && (
        <div className="story-end">
          <button
            type="button"
            className="soft-button"
            onClick={() => setIndex(0)}
          >
            Watch again
          </button>
          <button type="button" className="primary-button" onClick={close}>
            Done
          </button>
        </div>
      )}
    </dialog>
  );
}
