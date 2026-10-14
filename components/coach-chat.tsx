"use client";
import { useMutation, useQuery } from "convex/react";
import { ArrowUp, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "@/convex/_generated/api";
import { deviceTimeZone } from "./coach";
import { COACH_PENDING_MS, COACH_STALE_ERROR } from "@/lib/coach-chat";
import { Sheet, timeLabel, useClock, useTask } from "./ui";

const STARTERS = [
  "What should I eat tonight?",
  "Can I train legs tomorrow?",
  "Am I drinking enough today?",
  "What should I train next?",
];

export function CoachChatSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title="Ask your coach">
      <CoachChat />
    </Sheet>
  );
}

function CoachChat() {
  const messages = useQuery(api.coachChat.list, {});
  const send = useMutation(api.coachChat.send);
  const clock = useMutation(api.coachChat.clock);
  const clear = useMutation(api.coachChat.clear);
  const { run, pending } = useTask();
  const [text, setText] = useState("");
  const [confirming, setConfirming] = useState(false);
  const log = useRef<HTMLDivElement>(null);
  // Message times come from the server clock; learn this device's offset
  // from our own question so a skewed clock can't misjudge a stalled reply.
  const [sent, setSent] = useState<{ id: string; clientAt: number } | null>(
    null,
  );
  // Unknown until the server clock answers; no reply looks stalled before.
  const [skew, setSkew] = useState<number | null>(null);
  const mine = sent && messages?.find((m) => m._id === sent.id);
  if (sent && mine) {
    setSkew(mine.at - sent.clientAt);
    setSent(null);
  }
  useEffect(() => {
    const start = Date.now();
    void clock({})
      .then((server) => setSkew(server - (start + Date.now()) / 2))
      .catch(() => setSkew((s) => s ?? 0));
  }, [clock]);
  const now = useClock() + (skew ?? 0);
  const stalled = (m: { status: string; at: number }) =>
    skew !== null && m.status === "pending" && now - m.at >= COACH_PENDING_MS;
  const answering =
    messages?.some((m) => m.status === "pending" && !stalled(m)) ?? false;
  const busy = pending || answering;

  const last = messages?.at(-1);
  // Follow the conversation as questions and answers arrive.
  useEffect(() => {
    const sheet = log.current?.closest("dialog");
    sheet?.scrollTo({ top: sheet.scrollHeight });
  }, [last?._id, last?.status]);

  const ask = (question: string) => {
    if (!question.trim() || busy) return;
    void run(async () => {
      const start = Date.now();
      const id = await send({ text: question, timeZone: deviceTimeZone() });
      setSent({ id, clientAt: (start + Date.now()) / 2 });
      setText("");
    });
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    ask(text);
  };

  if (!messages)
    return (
      <p role="status" className="muted">
        Loading…
      </p>
    );
  return (
    <div className="chat" ref={log}>
      {messages.length === 0 ? (
        <div className="chat-empty">
          <span className="coach-mark large" aria-hidden>
            <Sparkles size={22} />
          </span>
          <p>
            Ask about your day. Your coach sees today’s log, your last week of
            water, meals and training, current muscle recovery and your latest
            check-in from this week. It doesn’t see your photos.
          </p>
          <div className="chat-starters">
            {STARTERS.map((s) => (
              <button
                key={s}
                type="button"
                className="chip"
                disabled={busy}
                onClick={() => ask(s)}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <>
          <div className="chat-tools">
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => {
                if (!confirming) return setConfirming(true);
                setConfirming(false);
                void run(() => clear({}), "Conversation cleared");
              }}
              onBlur={() => setConfirming(false)}
            >
              <Trash2 size={14} />
              {confirming ? "Tap again to clear" : "Clear conversation"}
            </button>
          </div>
          <ol className="chat-log" aria-live="polite">
            {messages.map((m) => {
              const status = stalled(m) ? "error" : m.status;
              return (
                <li key={m._id} className={`bubble ${m.role} ${status}`}>
                  {status === "pending" ? (
                    <span className="typing" role="status">
                      <span className="sr-only">Coach is typing</span>
                      <i />
                      <i />
                      <i />
                    </span>
                  ) : status === "error" ? (
                    <span role="alert">
                      {m.status === "pending"
                        ? COACH_STALE_ERROR
                        : (m.error ?? "The coach could not answer.")}
                    </span>
                  ) : (
                    m.text
                  )}
                  {status !== "pending" && (
                    <time dateTime={new Date(m.at).toISOString()}>
                      {timeLabel(m.at)}
                    </time>
                  )}
                </li>
              );
            })}
          </ol>
        </>
      )}
      <form className="chat-compose" onSubmit={submit}>
        <textarea
          aria-label="Your question"
          placeholder="Ask your coach…"
          rows={1}
          maxLength={1000}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault();
              ask(text);
            }
          }}
        />
        <button
          type="submit"
          className="chat-send"
          aria-label="Send"
          disabled={busy || !text.trim()}
        >
          <ArrowUp size={18} />
        </button>
      </form>
    </div>
  );
}
