"use client";
import { useMutation, useQuery } from "convex/react";
import { Copy, KeyRound, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import { convexSiteUrl } from "@/lib/shortcuts";
import { timeLabel, useTask, useToast } from "./ui";

const ROUTES = [
  {
    path: "/shortcuts/water",
    method: "POST",
    title: "Log water",
    body: '{ "amountMl": 250 }',
  },
  {
    path: "/shortcuts/checkin",
    method: "POST",
    title: "Check in",
    body: '{ "timeZone": "Europe/London", "weightKg": 72.4, "sleepHours": 7.5 }',
  },
  {
    path: "/shortcuts/today?timeZone=Europe/London",
    method: "GET",
    title: "Today’s summary",
    body: null,
  },
];

function siteUrl() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  try {
    return url ? convexSiteUrl(url) : null;
  } catch {
    return null;
  }
}

function when(at: number) {
  const day = new Date(at).toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
  return `${day}, ${timeLabel(at)}`;
}

export function ShortcutsSettings() {
  const status = useQuery(api.shortcuts.tokenStatus, {});
  const create = useMutation(api.shortcuts.createToken);
  const revoke = useMutation(api.shortcuts.revokeToken);
  const { run, pending } = useTask();
  const notify = useToast();
  const [fresh, setFresh] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<"replace" | "revoke" | null>(
    null,
  );
  const site = siteUrl();
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      notify(`${what} copied`);
    } catch {
      notify("Could not copy. Select the text and copy it instead.", true);
    }
  };
  const makeToken = () =>
    run(async () => setFresh(await create({})), "Token created");
  const confirm = (action: "replace" | "revoke") => {
    if (confirming !== action) return setConfirming(action);
    setConfirming(null);
    if (action === "replace") void makeToken();
    else
      void run(async () => {
        await revoke({});
        setFresh(null);
      }, "Token revoked");
  };

  return (
    <div className="sheet-section shortcuts">
      <h3>Apple Shortcuts</h3>
      <p className="muted small">
        Log water and check-ins from Siri, the Action Button or a Home Screen
        shortcut, without opening Daywell.
      </p>
      {status === undefined ? (
        <p role="status" className="muted small">
          Loading…
        </p>
      ) : status === null ? (
        <button
          type="button"
          className="secondary-button full"
          disabled={pending}
          onClick={() => void makeToken()}
        >
          <KeyRound size={17} /> Create a token
        </button>
      ) : (
        <>
          {fresh ? (
            <div className="token-reveal">
              <p className="small">
                <strong>Copy this token now.</strong> Daywell keeps only a
                fingerprint, so it won’t be shown again.
              </p>
              <div className="copy-row">
                <code aria-label="Your token">{fresh}</code>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Copy token"
                  onClick={() => void copy(fresh, "Token")}
                >
                  <Copy size={17} />
                </button>
              </div>
            </div>
          ) : (
            <p className="token-status small">
              <KeyRound size={15} aria-hidden />
              <span>
                <code>dw_{status.prefix}…</code> · created{" "}
                {when(status.createdAt)}
                {" · "}
                {status.lastUsedAt
                  ? `last used ${when(status.lastUsedAt)}`
                  : "not used yet"}
              </span>
            </p>
          )}
          <div className="row token-actions">
            <button
              type="button"
              className="text-button"
              disabled={pending}
              onClick={() => confirm("replace")}
              onBlur={() => setConfirming(null)}
            >
              <RefreshCw size={14} />
              {confirming === "replace"
                ? "Tap again: old token stops working"
                : "Replace token"}
            </button>
            <button
              type="button"
              className="text-button danger"
              disabled={pending}
              onClick={() => confirm("revoke")}
              onBlur={() => setConfirming(null)}
            >
              <Trash2 size={14} />
              {confirming === "revoke" ? "Tap again to revoke" : "Revoke"}
            </button>
          </div>
        </>
      )}
      {site && (
        <details className="shortcut-guide">
          <summary>How to set up a shortcut</summary>
          <ol className="small">
            <li>
              In the Shortcuts app, add <strong>Get Contents of URL</strong>.
            </li>
            <li>Paste an address below and set the method.</li>
            <li>
              Add a header <code>Authorization</code> with the value{" "}
              <code>Bearer</code> followed by a space and your token.
            </li>
            <li>
              For POST, set the request body to JSON with the fields shown.
            </li>
          </ol>
          <ul className="shortcut-routes">
            {ROUTES.map((r) => {
              const url = `${site}${r.path.replace("Europe/London", zone)}`;
              return (
                <li key={r.path}>
                  <div className="row spaced">
                    <strong className="small">{r.title}</strong>
                    <span className="method">{r.method}</span>
                  </div>
                  <div className="copy-row">
                    <code>{url}</code>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Copy ${r.title} address`}
                      onClick={() => void copy(url, "Address")}
                    >
                      <Copy size={16} />
                    </button>
                  </div>
                  {r.body && (
                    <code className="muted small">
                      {r.body.replace("Europe/London", zone)}
                    </code>
                  )}
                </li>
              );
            })}
          </ul>
        </details>
      )}
    </div>
  );
}
