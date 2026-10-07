import { ReviewWorkspace } from '@/components/ReviewWorkspace';

// The page itself is a server component; the interactive part is a client
// component. Keeps the client bundle limited to what actually needs the browser.
export default function HomePage() {
  return <ReviewWorkspace />;
}
