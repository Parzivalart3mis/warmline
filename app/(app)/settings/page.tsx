import { AppBar } from '@/components/app-bar';
import { SettingsView } from '@/components/settings/settings-view';

export const metadata = { title: 'Settings' };

export default function SettingsPage() {
  return (
    <>
      <AppBar title="Settings" />
      <main className="px-4 pt-4">
        <SettingsView />
      </main>
    </>
  );
}
