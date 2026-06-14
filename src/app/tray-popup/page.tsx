// Server Component shell for the tray popup route. Same prerender workaround
// as the main page (Next 16 + React 19 issue #85668).
import TrayPopupClient from './TrayPopupClient';

export default function Page() {
  return <TrayPopupClient />;
}
