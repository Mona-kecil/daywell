"use client";
import {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useId,
  type ReactNode,
} from "react";
import { CircleCheck, X, ArrowUpRight, Sprout } from "lucide-react";

type Notify = (
  message: string,
  error?: boolean,
  undo?: () => Promise<unknown>,
) => void;
const Feedback = createContext<Notify>(() => {});
export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<{
    text: string;
    error: boolean;
    undo?: () => Promise<unknown>;
  } | null>(null);
  const undo = async (revert: () => Promise<unknown>) => {
    setMessage(null);
    try {
      await revert();
      setMessage({ text: "Undone", error: false });
    } catch (error) {
      setMessage({
        text: error instanceof Error ? error.message : "Could not undo.",
        error: true,
      });
    }
  };
  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => setMessage(null), 6000);
      return () => clearTimeout(timer);
    }
  }, [message]);
  // A popover sits in the top layer, so toasts stay visible above modal sheets.
  const toast = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = toast.current;
    if (!el?.showPopover) return;
    if (el.matches(":popover-open")) el.hidePopover();
    el.showPopover();
  }, [message]);
  return (
    <Feedback.Provider
      value={(text, error = false, undo) => setMessage({ text, error, undo })}
    >
      {children}
      {message && (
        <div
          ref={toast}
          popover="manual"
          className={`toast ${message.error ? "error" : ""}`}
          role={message.error ? "alert" : "status"}
        >
          <CircleCheck size={20} />
          <span>{message.text}</span>
          {message.undo && (
            <button
              type="button"
              className="toast-undo"
              onClick={() => undo(message.undo!)}
            >
              Undo
            </button>
          )}
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
export const useToast = () => useContext(Feedback);
export function useTask() {
  const notify = useContext(Feedback);
  const [pending, setPending] = useState(false);
  // Pass `undo` to offer reverting the task's result from the toast.
  async function run<T>(
    task: () => Promise<T>,
    message?: string,
    undo?: (result: T) => Promise<unknown>,
  ) {
    setPending(true);
    try {
      const result = await task();
      if (message) notify(message, false, undo && (() => undo(result)));
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
  color,
}: {
  value: number;
  label: string;
  tone?: "green" | "blue" | "amber";
  color?: string;
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
      <span style={{ width: `${percentage}%`, background: color }} />
    </div>
  );
}
export function SectionTitle({
  title,
  detail,
  action,
  id,
}: {
  title: string;
  detail?: string;
  action?: ReactNode;
  id?: string;
}) {
  return (
    <div className="section-heading">
      <div>
        <h2 id={id}>{title}</h2>
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
// A modal bottom sheet. Children mount only while open so their queries stay idle.
export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => {
        // A click on the backdrop lands on the dialog element itself.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {open && (
        <div className="sheet-body">
          <div className="sheet-grip" aria-hidden />
          <div className="sheet-head">
            <h2 id={titleId}>{title}</h2>
            <button
              type="button"
              className="icon-button"
              aria-label="Close"
              onClick={onClose}
            >
              <X size={20} />
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}
