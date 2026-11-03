import { useEffect, useState, type FormEvent, type ReactNode } from "react";

type Status = "checking" | "signed-in" | "signed-out";

type Props = {
  children: (signOut: (() => void) | undefined) => ReactNode;
};

/** Shows the app to signed-in Energia users; everyone else gets the sign-in form. */
export function AuthGate({ children }: Props) {
  const [status, setStatus] = useState<Status>("checking");
  const [authDisabled, setAuthDisabled] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then(async (res) => {
        if (!res.ok) {
          setStatus("signed-out");
          return;
        }
        const me = (await res.json()) as { authDisabled?: boolean };
        setAuthDisabled(Boolean(me.authDisabled));
        setStatus("signed-in");
      })
      .catch(() => setStatus("signed-out"));
  }, []);

  const signIn = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { detail?: string }).detail || "Sign-in failed.");
      }
      setPassword("");
      setShowPassword(false);
      setStatus("signed-in");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    setStatus("signed-out");
  };

  if (status === "checking") return null;

  if (status === "signed-in") {
    return <>{children(authDisabled ? undefined : signOut)}</>;
  }

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={signIn}>
        <h1>PDF Edit</h1>
        <p>Sign in with your Energia account.</p>
        <label>
          Email
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <div className="auth-field">
          <label htmlFor="auth-password">Password</label>
          <div className="password-field">
            <input
              id="auth-password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <button
              type="button"
              className="password-toggle"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              aria-pressed={showPassword}
              title={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOffIcon /> : <EyeIcon />}
            </button>
          </div>
        </div>
        {error && (
          <div className="auth-error" role="alert">
            {error}
          </div>
        )}
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}

const eye = (extra?: ReactNode) => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
    <circle cx="12" cy="12" r="3" />
    {extra}
  </svg>
);

/** Password hidden: click to show it. */
const EyeIcon = () => eye();

/** Password shown: click to hide it again. */
const EyeOffIcon = () => eye(<path d="M3 3l18 18" />);
