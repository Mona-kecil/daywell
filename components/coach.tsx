"use client";
import { useConvex, useMutation, useQuery } from "convex/react";
import {
  BellOff,
  BellRing,
  MessageCircle,
  Download,
  Dumbbell,
  Droplets,
  Moon,
  ListChecks,
  Footprints,
  Plus,
  Sparkles,
  Utensils,
  X,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import { api } from "@/convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import {
  disablePush,
  enablePush,
  pushSupport,
  type PushSupport,
} from "@/lib/push-client";
import type { Suggestion } from "@/lib/coach";
import { dayKey } from "@/lib/insights";
import { CoachChatSheet } from "./coach-chat";
import { ShortcutsSettings } from "./shortcuts";
import { Sheet, useTask } from "./ui";
import type { Tab } from "./tracker";

export const deviceTimeZone = () =>
  Intl.DateTimeFormat().resolvedOptions().timeZone;

const KIND = {
  water: { Icon: Droplets, tone: "blue", tab: "water", cta: "Add water" },
  food: { Icon: Utensils, tone: "amber", tab: "meals", cta: "Log a meal" },
  train: { Icon: Dumbbell, tone: "green", tab: "train", cta: "Log workout" },
  rest: { Icon: Moon, tone: "green", tab: "train", cta: "See recovery" },
  habit: { Icon: ListChecks, tone: "green", tab: "today", cta: "See habits" },
  cardio: { Icon: Footprints, tone: "green", tab: "train", cta: "Log cardio" },
} satisfies Record<
  Suggestion["kind"],
  { Icon: typeof Droplets; tone: string; tab: Tab; cta: string }
>;

export function CoachCard({
  now,
  onTab,
}: {
  now: number;
  onTab: (tab: Tab) => void;
}) {
  // Re-query once a minute rather than on every clock tick.
  const minute = Math.floor(now / 60_000) * 60_000;
  const suggestions = useQuery(api.coach.suggestions, {
    now: minute,
    timeZone: deviceTimeZone(),
  });
  const [chatting, setChatting] = useState(false);
  if (!suggestions) return null;
  return (
    <section className="card coach-card" aria-labelledby="coach-title">
      <div className="coach-head">
        <span className="coach-mark" aria-hidden>
          <Sparkles size={16} />
        </span>
        <h2 id="coach-title">Coach</h2>
        <button
          type="button"
          className="soft-button coach-ask"
          onClick={() => setChatting(true)}
        >
          <MessageCircle size={15} /> Ask
        </button>
      </div>
      <CoachChatSheet open={chatting} onClose={() => setChatting(false)} />
      {suggestions.length === 0 ? (
        <p className="muted coach-clear">
          You’re on track. Nothing needs your attention right now.
        </p>
      ) : (
        <ol className="coach-list">
          {suggestions.map((s) => {
            const { Icon, tone, tab, cta } = KIND[s.kind];
            return (
              <li key={s.id}>
                <button
                  type="button"
                  className="coach-item"
                  onClick={() => onTab(tab)}
                >
                  <span className={`icon-tile small-tile ${tone}`}>
                    <Icon size={18} />
                  </span>
                  <span className="coach-text">
                    <strong>{s.title}</strong>
                    <span className="muted small">{s.body}</span>
                    <span className={`coach-cta ${tone}-text`}>{cta} →</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

const PUSH_COPY: Record<PushSupport, string> = {
  unsupported: "This browser can’t receive reminders.",
  "needs-install":
    "On iPhone, tap Share → Add to Home Screen, then open Daywell from there to turn on reminders.",
  denied:
    "Notifications are blocked. Allow them for this site in your browser settings.",
  default: "We’ll ask your browser for permission.",
  granted: "Notifications are allowed on this device.",
};

export function SettingsSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title="Settings">
      <SettingsBody />
    </Sheet>
  );
}

function SettingsBody() {
  const settings = useQuery(api.coach.settings, {});
  if (!settings)
    return (
      <p role="status" className="muted">
        Loading…
      </p>
    );
  return (
    <>
      <TargetsForm settings={settings} />
      <CheckInsForm saved={settings.checkIns} />
      <Reminders
        enabled={settings.remindersEnabled}
        timeZone={settings.timeZone}
      />
      <ShortcutsSettings />
      <ExportData />
    </>
  );
}

function ExportData() {
  const convex = useConvex();
  const { run, pending } = useTask();
  const download = () =>
    run(async () => {
      const data = await convex.query(api.exportData.all, {});
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `daywell-${dayKey(new Date())}.json`;
      link.click();
      URL.revokeObjectURL(link.href);
    }, "Export downloaded");
  return (
    <div className="sheet-section">
      <h3>Your data</h3>
      <p className="muted small">
        Everything you’ve logged — workouts and sets, water, meals, check-ins
        and settings — as one JSON file. Photos aren’t included.
      </p>
      <button
        type="button"
        className="secondary-button full"
        disabled={pending}
        onClick={() => void download()}
      >
        <Download size={17} /> {pending ? "Preparing…" : "Download export"}
      </button>
    </div>
  );
}

type Settings = FunctionReturnType<typeof api.coach.settings>;

function TargetsForm({ settings }: { settings: Settings }) {
  const setTargets = useMutation(api.coach.setTargets);
  const setWaterGoal = useMutation(api.tracker.setWaterGoal);
  const { run, pending } = useTask();
  const [water, setWater] = useState(String(settings.waterGoal));
  const [kcal, setKcal] = useState(settings.kcalTarget?.toString() ?? "");
  const [protein, setProtein] = useState(
    settings.proteinTarget?.toString() ?? "",
  );
  const optional = (s: string) => (s.trim() ? Number(s) : undefined);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await setWaterGoal({ goal: Number(water) });
      await setTargets({
        kcalTarget: optional(kcal),
        proteinTarget: optional(protein),
      });
    }, "Targets saved");
  };
  return (
    <form className="sheet-section" onSubmit={submit}>
      <h3>Daily targets</h3>
      <p className="muted small">
        The coach and your Today rings pace you against these. Leave calories or
        protein empty to skip them.
      </p>
      <div className="target-grid">
        <label>
          Water
          <span className="unit-input">
            <input
              inputMode="numeric"
              type="number"
              min={1}
              max={20000}
              required
              value={water}
              onChange={(e) => setWater(e.target.value)}
            />
            <span>ml</span>
          </span>
        </label>
        <label>
          Calories
          <span className="unit-input">
            <input
              inputMode="numeric"
              type="number"
              min={1}
              max={20000}
              placeholder="—"
              value={kcal}
              onChange={(e) => setKcal(e.target.value)}
            />
            <span>kcal</span>
          </span>
        </label>
        <label>
          Protein
          <span className="unit-input">
            <input
              inputMode="numeric"
              type="number"
              min={1}
              max={1000}
              placeholder="—"
              value={protein}
              onChange={(e) => setProtein(e.target.value)}
            />
            <span>g</span>
          </span>
        </label>
      </div>
      <button className="primary-button full" disabled={pending}>
        Save targets
      </button>
    </form>
  );
}

function CheckInsForm({ saved }: { saved: string[] }) {
  const setCheckIns = useMutation(api.coach.setCheckIns);
  const { run, pending } = useTask();
  const [draft, setDraft] = useState("12:00");
  const save = (next: string[], message: string) =>
    run(() => setCheckIns({ checkIns: next }), message);
  return (
    <div className="sheet-section">
      <h3>Check-in times</h3>
      <p className="muted small">
        When reminders are on, the coach nudges you at these times with the most
        useful next step.
      </p>
      <ul className="time-chips" aria-label="Check-in times">
        {saved.map((time) => (
          <li key={time}>
            <span>{time}</span>
            <button
              type="button"
              aria-label={`Remove ${time}`}
              disabled={pending}
              onClick={() =>
                void save(
                  saved.filter((t) => t !== time),
                  `Removed ${time}`,
                )
              }
            >
              <X size={14} />
            </button>
          </li>
        ))}
        {saved.length === 0 && <li className="muted small">No check-ins.</li>}
      </ul>
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (saved.includes(draft)) return;
          void save([...saved, draft], `Added ${draft}`);
        }}
      >
        <label className="sr-only" htmlFor="check-in-time">
          New check-in time
        </label>
        <input
          id="check-in-time"
          type="time"
          required
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button
          className="soft-button"
          disabled={pending || saved.length >= 24 || saved.includes(draft)}
        >
          <Plus size={16} /> Add
        </button>
      </form>
    </div>
  );
}

function Reminders({
  enabled,
  timeZone,
}: {
  enabled: boolean;
  timeZone: string | null;
}) {
  const setTimeZone = useMutation(api.coach.setTimeZone);
  const setEnabled = useMutation(api.coach.setRemindersEnabled);
  const subscribe = useMutation(api.push.subscribe);
  const unsubscribe = useMutation(api.push.unsubscribe);
  const { run, pending } = useTask();
  // Only mounted while the sheet is open, so this never runs during SSR.
  const [support, setSupport] = useState<PushSupport>(pushSupport);
  const zone = deviceTimeZone();

  const turnOn = () =>
    run(async () => {
      await setTimeZone({ timeZone: zone });
      await enablePush(subscribe);
      await setEnabled({ enabled: true });
    }, "Reminders on").finally(() => setSupport(pushSupport()));
  const turnOff = () =>
    run(async () => {
      await setEnabled({ enabled: false });
      await disablePush(unsubscribe);
    }, "Reminders off");

  const blocked =
    support === "unsupported" ||
    support === "needs-install" ||
    support === "denied";
  return (
    <div className="sheet-section">
      <h3>Reminders</h3>
      <div className="reminder-row">
        <span className={`icon-tile small-tile ${enabled ? "green" : ""}`}>
          {enabled ? <BellRing size={18} /> : <BellOff size={18} />}
        </span>
        <div className="grow">
          <strong>{enabled ? "On" : "Off"}</strong>
          <p className="muted small">
            {timeZone ?? zone}
            {timeZone && timeZone !== zone ? ` · this device is ${zone}` : ""}
          </p>
        </div>
        {enabled ? (
          <button
            type="button"
            className="secondary-button"
            disabled={pending}
            onClick={() => void turnOff()}
          >
            Turn off
          </button>
        ) : (
          <button
            type="button"
            className="primary-button"
            disabled={pending || blocked}
            onClick={() => void turnOn()}
          >
            Turn on
          </button>
        )}
      </div>
      {!enabled && (
        <p className={`small ${blocked ? "amber-text" : "muted"}`}>
          {PUSH_COPY[support]}
        </p>
      )}
      {enabled && timeZone && timeZone !== zone && (
        <button
          type="button"
          className="text-button"
          disabled={pending}
          onClick={() =>
            void run(() => setTimeZone({ timeZone: zone }), "Time zone updated")
          }
        >
          Use {zone}
        </button>
      )}
    </div>
  );
}
