"use client";
import { useAuth } from "@workos-inc/authkit-nextjs/components";
import { useEffect, useState } from "react";
import {
  Authenticated,
  Unauthenticated,
  AuthLoading,
  useMutation,
  useQuery,
} from "convex/react";
import {
  CalendarDays,
  Dumbbell,
  Droplets,
  Utensils,
  Moon,
  Sun,
  ArrowRight,
  LogOut,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import { localDayRange } from "@/lib/day";
import { mealTotals, sumNutrients } from "@/lib/nutrients";
import { Brand, FeedbackProvider, useClock } from "./ui";
import { Today } from "./today";
import { Train } from "./train";
import { Water } from "./water";
import { Meals } from "./meals";
export type Tab = "today" | "train" | "water" | "meals";
const tabs = [
  { id: "today", label: "Today", Icon: CalendarDays },
  { id: "train", label: "Train", Icon: Dumbbell },
  { id: "water", label: "Water", Icon: Droplets },
  { id: "meals", label: "Meals", Icon: Utensils },
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
export function Tracker() {
  return (
    <FeedbackProvider>
      <Authenticated>
        <Dashboard />
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
            <a className="primary-button full" href="/login">
              Sign in or create an account <ArrowRight size={18} />
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
function Dashboard() {
  const { signOut } = useAuth();
  const [tab, setTab] = useState<Tab>("today");
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
    setTab(next);
    window.scrollTo({ top: 0, behavior: "instant" });
  };
  return (
    <div className="app-shell">
      <header className="topbar">
        <Brand />
        <div className="row">
          <ThemeToggle />
          <button
            className="icon-button"
            aria-label="Sign out"
            onClick={() => void signOut()}
          >
            <LogOut size={19} />
          </button>
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
                mealCount={meals.length}
                pendingMeals={
                  meals.filter((m) => m.analysis.status !== "ready").length
                }
                onTab={changeTab}
              />
            )}
            {tab === "train" && <Train muscles={overview.muscles} now={now} />}
            {tab === "water" && (
              <Water entries={water} goal={overview.waterGoal} />
            )}
            {tab === "meals" && (
              <Meals meals={meals} totals={totals} now={now} />
            )}
          </div>
        )}
      </main>
      <nav className="tabbar" aria-label="Main navigation">
        {tabs.map(({ id, label, Icon }) => (
          <button
            key={id}
            className={tab === id ? "active" : ""}
            aria-current={tab === id ? "page" : undefined}
            onClick={() => changeTab(id)}
          >
            <Icon size={22} strokeWidth={1.7} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
