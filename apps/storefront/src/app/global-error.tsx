'use client';

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en-IN">
      <body
        style={{
          fontFamily: 'system-ui, sans-serif',
          display: 'grid',
          placeItems: 'center',
          minHeight: '100vh',
          margin: 0,
        }}
      >
        <div style={{ textAlign: 'center', padding: 24 }}>
          <h1 style={{ fontSize: 20 }}>VYRA is having a moment</h1>
          <p style={{ color: '#737373', fontSize: 14 }}>
            Please refresh the page or try again shortly.
          </p>
          <button
            onClick={reset}
            style={{
              marginTop: 16,
              background: '#ff3f6c',
              color: '#fff',
              border: 0,
              borderRadius: 10,
              padding: '10px 18px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
