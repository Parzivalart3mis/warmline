import { PageShell } from '@/components/page-shell';
import { QueueBoard } from '@/components/queue/queue-board';

export const metadata = { title: 'Queue' };

export default function QueuePage() {
  return (
    <PageShell title="Queue">
      <QueueBoard />
    </PageShell>
  );
}
