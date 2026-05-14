import { signIn } from "../../auth";
import "./sign-in.css";

export default function SignInPage() {
  const hasGoogle = Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);

  return (
    <main className="sign-in-page">
      <section className="sign-in-card">
        <div className="brand-mark">C</div>
        <h1>Sign in to Council</h1>
        <p>Use your account to keep chat history, model settings, API keys, and run logs private.</p>
        {hasGoogle ? (
          <form
            action={async () => {
              "use server";
              await signIn("google", { redirectTo: "/" });
            }}
          >
            <button type="submit">Continue with Google</button>
          </form>
        ) : (
          <div className="sign-in-warning">
            Configure <code>AUTH_GOOGLE_ID</code> and <code>AUTH_GOOGLE_SECRET</code>.
          </div>
        )}
      </section>
    </main>
  );
}
