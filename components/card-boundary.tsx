"use client";
import { ConvexError } from "convex/values";
import { Component, type ReactNode, useId } from "react";
import { SectionTitle } from "./ui";

// Server-side limits arrive as ConvexError strings meant for the user;
// anything else stays generic.
function messageFor(error: unknown) {
  return error instanceof ConvexError && typeof error.data === "string"
    ? error.data
    : "This card couldn't load.";
}

function FailedCard({
  title,
  error,
  onRetry,
}: {
  title: string;
  error: unknown;
  onRetry: () => void;
}) {
  const id = useId();
  return (
    <section className="card" aria-labelledby={id}>
      <SectionTitle title={title} id={id} />
      <p className="muted">{messageFor(error)}</p>
      <button type="button" className="soft-button" onClick={onRetry}>
        Try again
      </button>
    </section>
  );
}

// Keeps one failing Insights card from taking the whole tab down.
export class CardBoundary extends Component<
  { title: string; children: ReactNode },
  { error: unknown; failed: boolean }
> {
  state = { error: null as unknown, failed: false };
  static getDerivedStateFromError(error: unknown) {
    return { error, failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <FailedCard
        title={this.props.title}
        error={this.state.error}
        onRetry={() => this.setState({ error: null, failed: false })}
      />
    );
  }
}
