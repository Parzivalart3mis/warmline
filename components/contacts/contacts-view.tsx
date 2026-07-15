'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { Users, Plus, Upload, Search } from 'lucide-react';
import { fetcher } from '@/lib/api-client';
import type { ContactDTO, ResumeDTO } from '@/lib/types';
import { fullName } from '@/lib/types';
import { StatusPill, type PillStatus } from '@/components/status-pill';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
  SheetTrigger,
} from '@/components/ui/sheet';
import { initials } from '@/lib/format';
import { ContactForm } from './contact-form';
import { CsvImport } from './csv-import';
import { ContactActions } from './contact-actions';

const FILTERS: Array<{ value: PillStatus | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'not_sent', label: 'Not sent' },
  { value: 'sent', label: 'Sent' },
  { value: 'replied', label: 'Replied' },
  { value: 'failed', label: 'Failed' },
  { value: 'suppressed', label: 'Suppressed' },
];

export function ContactsView() {
  const [filter, setFilter] = useState<PillStatus | 'all'>('all');
  const [q, setQ] = useState('');
  const [sheet, setSheet] = useState<null | 'add' | 'import' | { edit: ContactDTO }>(null);

  const params = new URLSearchParams();
  if (filter !== 'all') params.set('status', filter);
  if (q.trim()) params.set('q', q.trim());
  const key = `/api/contacts${params.toString() ? `?${params}` : ''}`;

  const { data, error, isLoading, mutate } = useSWR<{ contacts: ContactDTO[] }>(key, fetcher);
  const { data: resumeData } = useSWR<{ resumes: ResumeDTO[] }>('/api/resumes', fetcher);
  const resumes = resumeData?.resumes ?? [];

  const closeAndRefresh = () => {
    setSheet(null);
    void mutate();
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted"
            aria-hidden="true"
          />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, company, email"
            className="pl-9"
            aria-label="Search contacts"
            autoCapitalize="none"
          />
        </div>
      </div>

      <div className="ui-chrome -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            aria-pressed={filter === f.value}
            className={`min-h-9 shrink-0 rounded-xl border px-3 text-sm ${
              filter === f.value ? 'border-primary bg-primary/10 text-primary' : 'text-muted'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="flex gap-2">
        <Sheet open={sheet === 'add'} onOpenChange={(o) => setSheet(o ? 'add' : null)}>
          <SheetTrigger asChild>
            <Button className="flex-1">
              <Plus /> Add contact
            </Button>
          </SheetTrigger>
          <SheetContent>
            <SheetTitle>New contact</SheetTitle>
            <SheetDescription>Everything the draft needs to feel personal.</SheetDescription>
            <ContactForm resumes={resumes} onDone={closeAndRefresh} />
          </SheetContent>
        </Sheet>

        <Sheet open={sheet === 'import'} onOpenChange={(o) => setSheet(o ? 'import' : null)}>
          <SheetTrigger asChild>
            <Button variant="secondary" className="flex-1">
              <Upload /> Import CSV
            </Button>
          </SheetTrigger>
          <SheetContent>
            <SheetTitle>Import contacts</SheetTitle>
            <SheetDescription>Review the parsed rows before anything is saved.</SheetDescription>
            <CsvImport onDone={closeAndRefresh} />
          </SheetContent>
        </Sheet>
      </div>

      {isLoading ? (
        <ListSkeleton rows={8} />
      ) : error ? (
        <ErrorState message="Could not load your contacts." onRetry={() => mutate()} />
      ) : (data?.contacts.length ?? 0) === 0 ? (
        <EmptyState
          icon={Users}
          title={q || filter !== 'all' ? 'No contacts match' : 'No contacts yet'}
          hint={
            q || filter !== 'all'
              ? 'Try a different search or filter.'
              : 'Import a CSV or add one by hand to start reaching out.'
          }
        />
      ) : (
        <ul className="overflow-hidden rounded-lg border">
          {data!.contacts.map((c, i) => (
            <li
              key={c.id}
              className={`flex items-center gap-3 bg-surface px-3 py-2.5 ${
                i === data!.contacts.length - 1 ? '' : 'border-b'
              }`}
            >
              <span
                aria-hidden="true"
                className="tabular flex size-9 shrink-0 items-center justify-center rounded-xl border text-xs text-muted"
              >
                {initials(c.firstName, c.lastName)}
              </span>
              <button
                className="min-w-0 flex-1 text-left"
                onClick={() => setSheet({ edit: c })}
                aria-label={`Edit ${fullName(c)}`}
              >
                <p className="truncate font-medium">{fullName(c)}</p>
                <p className="truncate text-sm text-muted">
                  {c.company || c.email}
                  {c.targetRole ? ` · ${c.targetRole}` : ''}
                </p>
              </button>
              <StatusPill status={c.status as PillStatus} />
              <ContactActions
                contact={c}
                onEdit={() => setSheet({ edit: c })}
                onChanged={() => mutate()}
              />
            </li>
          ))}
        </ul>
      )}

      <Sheet
        open={typeof sheet === 'object' && sheet !== null}
        onOpenChange={(o) => !o && setSheet(null)}
      >
        <SheetContent>
          <SheetTitle>Edit contact</SheetTitle>
          <SheetDescription>Changes apply to future drafts.</SheetDescription>
          {typeof sheet === 'object' && sheet !== null && (
            <ContactForm resumes={resumes} existing={sheet.edit} onDone={closeAndRefresh} />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
