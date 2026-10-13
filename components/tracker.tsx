"use client";
import { useAuth } from "@workos-inc/authkit-nextjs/components";
import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import {
  Authenticated,
  Unauthenticated,
  AuthLoading,
  useMutation,
  useQuery,
} from "convex/react";
import {
  CalendarDays,
  ChartColumn,
  Dumbbell,
  Droplets,
  Utensils,
  Moon,
  Sun,
  ArrowRight,
  LogOut,
  Settings2,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import { localDayRange } from "@/lib/day";
import { mealTotals, sumNutrients } from "@/lib/nutrients";
import { Brand, FeedbackProvider, useClock } from "./ui";
import { Today } from "./today";
import { Train } from "./train";
import { Water } from "./water";
import { Meals } from "./meals";
import { Insights } from "./insights";
import { SettingsSheet, deviceTimeZone } from "./coach";
import { disablePush } from "@/lib/push-client";
export type Tab = "today" | "train" | "water" | "meals" | "insights";
const tabs = [
  { id: "today", label: "Today", Icon: CalendarDays },
  { id: "train", label: "Train", Icon: Dumbbell },
  { id: "water", label: "Water", Icon: Droplets },
  { id: "meals", label: "Meals", Icon: Utensils },
  { id: "insights", label: "Insights", Icon: ChartColumn },
] satisfies { id: Tab; label: string; Icon: typeof CalendarDays }[];
export function ThemeToggle() {
  const [dark, setDark] = useState<boolean | null>(null);
  return (
    <button
      className="icon-button"
      aria-label="Toggle light or dark mode"
      onClick={() => {
        const next = !(
          dark ?? window.matchMedia("(prefers-color-scheme: dark)").matches
        );
        document.documentElement.dataset.theme = next ? "dark" : "light";
        setDark(next);
      }}
    >
      {dark ? <Sun size={20} /> : <Moon size={20} />}
    </button>
  );
}
export function Tracker({ devAuth = false }: { devAuth?: boolean }) {
  return (
    <FeedbackProvider>
      <Authenticated>
        <Dashboard devAuth={devAuth} />
      </Authenticated>
      <Unauthenticated>
        <div className="app-shell">
          <header className="topbar">
            <Brand />
            <ThemeToggle />
          </header>
          <main className="auth-screen">
            <span className="icon-tile green">
              <CalendarDays size={27} />
            </span>
            <h1>Your day starts here.</h1>
            <p className="muted">
              Sign in to keep your workouts, water, and meals in your own
              account.
            </p>
            <a
              className="primary-button full"
              href={devAuth ? "/dev-login" : "/login"}
            >
              {devAuth ? "Sign in as Dev User" : "Sign in or create an account"}{" "}
              <ArrowRight size={18} />
            </a>
          </main>
        </div>
      </Unauthenticated>
      <AuthLoading>
        <div className="app-shell">
          <header className="topbar">
            <Brand />
          </header>
          <main className="auth-screen">
            <p role="status">Opening your day…</p>
          </main>
        </div>
      </AuthLoading>
    </FeedbackProvider>
  );
}
// Drop this device's push subscription while the session can still authorize it.
function useReleasePush() {
  const unsubscribe = useMutation(api.push.unsubscribe);
  return () => disablePush(unsubscribe).catch(() => {});
}
const isTab = (value: string | null): value is Tab =>
  tabs.some((t) => t.id === value);
function WorkOSSignOut() {
  const { signOut } = useAuth();
  const releasePush = useReleasePush();
  return (
    <button
      className="icon-button"
      aria-label="Sign out"
      onClick={async () => {
        await releasePush();
        await signOut();
      }}
    >
      <LogOut size={19} />
    </button>
  );
}
function Dashboard({ devAuth }: { devAuth: boolean }) {
  // Reminder notifications open /?tab=water|meals|train. Dashboard only renders
  // once the client is authenticated, so reading the URL here is safe.
  const [tab, setTab] = useState<Tab>(() => {
    const linked = new URLSearchParams(window.location.search).get("tab");
    return isTab(linked) ? linked : "today";
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const releasePush = useReleasePush();
  const [initError, setInitError] = useState<string | null>(null);
  const now = useClock();
  const initialize = useMutation(api.tracker.initialize);
  useEffect(() => {
    void initialize({}).catch((error) =>
      setInitError(
        error instanceof Error
          ? error.message
          : "Could not initialize your account.",
      ),
    );
  }, [initialize]);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("tab")) return;
    url.searchParams.delete("tab");
    window.history.replaceState(null, "", url);
  }, []);
  const settings = useQuery(api.coach.settings, {});
  const setTimeZone = useMutation(api.coach.setTimeZone);
  useEffect(() => {
    if (settings && settings.timeZone === null)
      void setTimeZone({ timeZone: deviceTimeZone() }).catch(() => {});
  }, [settings, setTimeZone]);
  const overview = useQuery(api.tracker.overview, {});
  const day = localDayRange(new Date(now));
  const water = useQuery(api.tracker.waterToday, day),
    meals = useQuery(api.meals.today, day);
  const totals = sumNutrients(
    (meals ?? [])
      .filter((m) => m.analysis.status === "ready")
      .map((m) => mealTotals(m.items)),
  );
  const changeTab = (next: Tab) => {
    const swap = () => {
      flushSync(() => setTab(next));
      window.scrollTo({ top: 0, behavior: "instant" });
    };
    const order = tabs.map((t) => t.id);
    const root = document.documentElement;
    if (
      next === tab ||
      !document.startViewTransition ||
      matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return swap();
    // Slide in the direction of travel along the tab bar.
    root.dataset.nav =
      order.indexOf(next) > order.indexOf(tab) ? "forward" : "back";
    document
      .startViewTransition(swap)
      .finished.finally(() => delete root.dataset.nav);
  };
  return (
    <div className="app-shell">
      <header className="topbar">
        <Brand />
        <div className="row">
          <ThemeToggle />
          <button
            className="icon-button"
            aria-label="Settings"
            aria-haspopup="dialog"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings2 size={20} />
          </button>
          {devAuth ? (
            <button
              className="icon-button"
              aria-label="Sign out"
              onClick={async () => {
                await releasePush();
                await fetch("/api/dev-token", { method: "DELETE" });
                window.location.reload();
              }}
            >
              <LogOut size={19} />
            </button>
          ) : (
            <WorkOSSignOut />
          )}
        </div>
      </header>
      <main id="main-content">
        <div className="date-line">
          <span className="date-dot" />
          {new Date(now).toLocaleDateString([], {
            weekday: "long",
            month: "long",
            day: "numeric",
          })}
        </div>
        {initError ? (
          <div className="card" role="alert">
            <p>{initError}</p>
            <button
              className="primary-button"
              onClick={() => window.location.reload()}
            >
              Try again
            </button>
          </div>
        ) : !overview || !overview.muscles.length || !water || !meals ? (
          <div className="card" role="status">
            Loading your day…
          </div>
        ) : (
          <div key={tab} className="screen">
            {tab === "today" && (
              <Today
                now={now}
                overview={overview}
                waterMl={water.reduce((sum, e) => sum + e.amountMl, 0)}
                totals={totals}
                targets={settings}
                mealCount={meals.length}
                pendingMeals={
                  meals.filter((m) => m.analysis.status !== "ready").length
                }
                onTab={changeTab}
              />
            )}
            {tab === "train" && <Train muscles={overview.muscles} now={now} />}
            {tab === "water" && (
              <Water entries={water} goal={overview.waterGoal} now={now} />
            )}
            {tab === "meals" && (
              <Meals meals={meals} totals={totals} now={now} />
            )}
            {tab === "insights" && <Insights now={now} />}
          </div>
        )}
      </main>
      <SettingsSheet
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
      <nav className="tabbar" aria-label="Main navigation">
        {tabs.map(({ id, label, Icon }) => (
          <button
            key={id}
            className={tab === id ? "active" : ""}
            aria-current={tab === id ? "page" : undefined}
            onClick={() => changeTab(id)}
          >
            {tab === id && <span className="tab-pill" aria-hidden />}
            <Icon size={22} strokeWidth={1.7} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
