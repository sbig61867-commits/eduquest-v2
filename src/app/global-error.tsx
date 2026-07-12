'use client'

// Catches errors thrown by the root layout itself. Must render its own
// <html>/<body> because the root layout is what failed. Kept dependency-free
// (no Tailwind classes are guaranteed here if globals.css failed to load).
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0f172a', color: '#fff', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ textAlign: 'center', padding: 24 }}>
          <h1 style={{ fontSize: 20, marginBottom: 8 }}>Something went wrong</h1>
          <p style={{ color: '#94a3b8', fontSize: 14, marginBottom: 8 }}>
            An unexpected error occurred. Please try again.
          </p>
          {error.digest && (
            <p style={{ color: '#64748b', fontSize: 12, fontFamily: 'monospace', marginBottom: 16 }}>
              Error ID: {error.digest}
            </p>
          )}
          <button
            onClick={reset}
            style={{ padding: '10px 20px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, cursor: 'pointer' }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  )
}
