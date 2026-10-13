import { authConfigured } from "@/lib/auth-configured";
import { devAuthConfigured } from "@/lib/dev-auth-config";
import { Providers } from "@/components/providers";
import { Tracker, ThemeToggle } from "@/components/tracker";
import { Brand } from "@/components/ui";
export const dynamic = "force-dynamic";
export default function Home() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  const devAuth = devAuthConfigured();
  if ((!authConfigured() && !devAuth) || !url)
    return (
      <div className="app-shell">
        <header className="topbar">
          <Brand />
          <ThemeToggle />
        </header>
        <main className="auth-screen" id="main-content">
          <div className="eyebrow">SETUP</div>
          <h1>A home for your day.</h1>
          <p className="muted">
            Your tracker is built. Connect your account to start saving your
            workouts, water, and meals.
          </p>
          <div className="card setup-card">
            <h2>Connect Daywell</h2>
            <ol>
              <li>
                Copy <code>.env.example</code> to <code>.env.local</code>.
              </li>
              <li>
                Run <code>pnpm dev:setup</code> or add your WorkOS keys.
              </li>
              <li>Start Convex and set its WorkOS client ID.</li>
              <li>Restart the app, then sign in.</li>
            </ol>
            <p className="muted small">
              The README has the commands and account settings.
            </p>
          </div>
          <p className="muted small">
            No account credentials are configured yet.
          </p>
        </main>
      </div>
    );
  return (
    <Providers url={url} devAuth={devAuth}>
      <Tracker devAuth={devAuth} />
    </Providers>
  );
}
