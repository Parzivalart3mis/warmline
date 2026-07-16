import { PageShell } from '@/components/page-shell';
import { SettingsView } from '@/components/settings/settings-view';

export const metadata = { title: 'Settings' };

export default function SettingsPage() {
  return (
    <PageShell title="Settings">
      <SettingsView />
    </PageShell>
  );
}
