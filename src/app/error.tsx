'use client';

// Route-level error boundary (distinct from global-error). Suppresses Next's
// internal error-page prerender which fails under React 19.
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div style={{ padding: 48, textAlign: 'center', color: '#fca5a5', fontFamily: 'system-ui' }}>
      <h2 style={{ fontSize: 20, fontWeight: 700 }}>Something went wrong</h2>
      <p style={{ fontSize: 14, opacity: 0.7 }}>{error.message}</p>
      <button onClick={() => reset()} style={{ marginTop: 16, padding: '8px 16px' }}>Try again</button>
    </div>
  );
}
