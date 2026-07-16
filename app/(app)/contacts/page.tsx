import { PageShell } from '@/components/page-shell';
import { ContactsView } from '@/components/contacts/contacts-view';

export const metadata = { title: 'Contacts' };

export default function ContactsPage() {
  return (
    <PageShell title="Contacts">
      <ContactsView />
    </PageShell>
  );
}
