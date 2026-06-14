'use client';

// Custom 404 page. Next 16's internal _not-found page fails to prerender under
// React 19 (issue #85668); providing our own avoids the broken internal page.
export default function NotFound() {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#0a0a0f',
      color: '#e5e7eb',
      fontFamily: 'system-ui, sans-serif',
    }}>
      <div style={{ textAlign: 'center' }}>
        <h1 style={{ fontSize: 48, fontWeight: 800, marginBottom: 8 }}>404</h1>
        <p style={{ opacity: 0.6 }}>Page not found.</p>
      </div>
    </div>
  );
}
