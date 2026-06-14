// Server Component shell for the block overlay route. Same prerender workaround
// as the main page (Next 16 + React 19 issue #85668).
import BlockOverlayClient from './BlockOverlayClient';

export default function Page() {
  return <BlockOverlayClient />;
}
