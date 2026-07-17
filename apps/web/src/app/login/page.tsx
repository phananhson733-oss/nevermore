/**
 * Login shell (WP0). The Supabase sign-in form and localized copy are wired in
 * WP1; this page exists so the middleware redirect target resolves.
 */
export default function LoginPage() {
  return (
    <main style={{ maxWidth: 420, margin: "10vh auto", padding: "0 24px" }}>
      <h1 style={{ fontSize: 24, marginBottom: 8 }}>SignalFrame</h1>
      <p style={{ color: "var(--sf-muted)" }}>Internal delivery workbench.</p>
    </main>
  );
}
