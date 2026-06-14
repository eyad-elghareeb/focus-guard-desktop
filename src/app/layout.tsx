import './globals.css';
import type { Viewport } from 'next';

// Metadata is intentionally minimal — heavy metadata objects cause prerender
// failures with React 19's head management on Next 16.
export const metadata = {
  title: 'FocusGuard Desktop',
  description: 'Track desktop apps, block distractions, stay focused.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased" style={{ margin: 0, padding: 0 }}>
        {children}
      </body>
    </html>
  );
}
