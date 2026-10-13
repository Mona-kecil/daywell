"use client";
export default function ErrorScreen({ reset }: { reset: () => void }) {
  return (
    <main className="auth-screen" id="main-content">
      <h1>Could not open your day.</h1>
      <p>Please check your connection and try again.</p>
      <button className="primary-button" onClick={reset}>
        Try again
      </button>
    </main>
  );
}
