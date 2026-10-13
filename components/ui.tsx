"use client";
import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from "react";
import { CircleCheck, X, ArrowUpRight, Sprout } from "lucide-react";

const Feedback = createContext<(message: string, error?: boolean) => void>(
  () => {},
);
export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<{
    text: string;
    error: boolean;
  } | null>(null);
  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => setMessage(null), 6000);
      return () => clearTimeout(timer);
    }
  }, [message]);
  return (
    <Feedback.Provider
      value={(text, error = false) => setMessage({ text, error })}
    >
      {children}
      {message && (
        <div
          className={`toast ${message.error ? "error" : ""}`}
          role={message.error ? "alert" : "status"}
        >
          <CircleCheck size={20} />
          <span>{message.text}</span>
          <button
            aria-label="Dismiss notification"
            onClick={() => setMessage(null)}
          >
            <X size={18} />
          </button>
        </div>
      )}
    </Feedback.Provider>
  );
}
export function useTask() {
  const notify = useContext(Feedback);
  const [pending, setPending] = useState(false);
  async function run(task: () => Promise<unknown>, message?: string) {
    setPending(true);
    try {
      await task();
      if (message) notify(message);
      return true;
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Could not save. Please try again.",
        true,
      );
      return false;
    } finally {
      setPending(false);
    }
  }
  return { run, pending };
}
export function useClock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const timer = setInterval(tick, 15_000);
    window.addEventListener("focus", tick);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", tick);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);
  return now;
}
export function Progress({
  value,
  label,
  tone = "green",
}: {
  value: number;
  label: string;
  tone?: "green" | "blue" | "amber";
}) {
  const percentage = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div
      className={`progress ${tone}`}
      role="progressbar"
      aria-label={label}
      aria-valuenow={percentage}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <span style={{ width: `${percentage}%` }} />
    </div>
  );
}
export function SectionTitle({
  title,
  detail,
  action,
}: {
  title: string;
  detail?: string;
  action?: ReactNode;
}) {
  return (
    <div className="section-heading">
      <div>
        <h2>{title}</h2>
        {detail && <p className="muted small">{detail}</p>}
      </div>
      {action}
    </div>
  );
}
export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}
export function Brand() {
  return (
    <span className="brand">
      <span className="brand-mark">
        <Sprout size={23} strokeWidth={1.7} />
      </span>
      daywell<span className="brand-dot">.</span>
    </span>
  );
}
export function ActionLink({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button className="text-button" onClick={onClick}>
      {children}
      <ArrowUpRight size={16} />
    </button>
  );
}
export function timeLabel(at: number) {
  return new Date(at).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}
