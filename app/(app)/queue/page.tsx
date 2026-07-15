import { AppBar } from '@/components/app-bar';
import { QueueBoard } from '@/components/queue/queue-board';

export const metadata = { title: 'Queue' };

export default function QueuePage() {
  return (
    <>
      <AppBar title="Queue" />
      <main className="px-4 pt-4">
        <QueueBoard />
      </main>
    </>
  );
}
