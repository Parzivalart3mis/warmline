import { AppBar } from '@/components/app-bar';
import { ContactsView } from '@/components/contacts/contacts-view';

export const metadata = { title: 'Contacts' };

export default function ContactsPage() {
  return (
    <>
      <AppBar title="Contacts" />
      <main className="px-4 pt-4">
        <ContactsView />
      </main>
    </>
  );
}
