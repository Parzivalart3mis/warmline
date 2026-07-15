import { AppBar } from '@/components/app-bar';
import { DraftsView } from '@/components/drafts/drafts-view';

export const metadata = { title: 'Drafts' };

export default function DraftsPage() {
  return (
    <>
      <AppBar title="Drafts" />
      <main className="px-4 pt-4">
        <DraftsView />
      </main>
    </>
  );
}
