// Server Component entry. We can't use `next/dynamic({ ssr: false })` here
// (that requires a Client Component). Instead we import the client component
// directly. The prerender of this route produces a static HTML shell; React
// hydrates and runs the full client app on mount.
import FocusGuardDesktop from './FocusGuardClient';

export default function Page() {
  return <FocusGuardDesktop />;
}
