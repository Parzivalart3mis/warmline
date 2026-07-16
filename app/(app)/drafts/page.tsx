import { PageShell } from '@/components/page-shell';
import { DraftsView } from '@/components/drafts/drafts-view';

export const metadata = { title: 'Drafts' };

export default function DraftsPage() {
  return (
    <PageShell title="Drafts">
      <DraftsView />
    </PageShell>
  );
}
