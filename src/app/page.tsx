import { ReviewWorkspace } from '@/components/ReviewWorkspace';
import { getEnv } from '@/lib/env';

// Read per request: whether this is the recorded demo is a runtime setting, and a
// statically built page would freeze whatever it was at build time.
export const dynamic = 'force-dynamic';

// The page itself is a server component; the interactive part is a client
// component. Keeps the client bundle limited to what actually needs the browser.
export default function HomePage() {
  let demo = false;
  try {
    demo = getEnv().LLM_PROVIDER === 'replay';
  } catch {
    // Invalid settings: the API routes report that. The page still loads as a normal build.
  }
  return <ReviewWorkspace demo={demo} />;
}
