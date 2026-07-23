'use client';

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { FileText, PenLine, PauseCircle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { fetcher, apiSend, ClientError } from '@/lib/api-client';
import type { ContactDTO, MessageWithContact } from '@/lib/types';
import { fullName } from '@/lib/types';
import { StatusPill, type PillStatus } from '@/components/status-pill';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { relativeTime, timeOfDay } from '@/lib/format';
import { DraftEditor } from './draft-editor';

type SheetState =
  | { kind: 'edit'; message: MessageWithContact }
  | { kind: 'review'; message: MessageWithContact }
  | { kind: 'new'; contact: ContactDTO }
  | { kind: 'pick' }
  | null;

export function DraftsView() {
  const { data, error, isLoading, mutate } = useSWR<{ messages: MessageWithContact[] }>(
    '/api/messages?status=needs_review',
    fetcher,
    { refreshInterval: 20_000 },
  );
  const { data: drafts, mutate: mutateDrafts } = useSWR<{ messages: MessageWithContact[] }>(
    '/api/messages?status=draft',
    fetcher,
  );
  const { data: queuedData, mutate: mutateQueued } = useSWR<{ messages: MessageWithContact[] }>(
    '/api/messages?status=queued',
    fetcher,
    { refreshInterval: 15_000 },
  );
  const [sheet, setSheet] = useState<SheetState>(null);
  const [cancelling, setCancelling] = useState(false);

  const held = data?.messages ?? [];
  const draftRows = drafts?.messages ?? [];
  const queued = queuedData?.messages ?? [];
  const all = [...held, ...draftRows];

  const refresh = () => {
    setSheet(null);
    void mutate();
    void mutateDrafts();
    void mutateQueued();
  };

  /** Pull one queued email out of its run; the rest keep sending. */
  const cancelQueued = async (m: MessageWithContact) => {
    setCancelling(true);
    try {
      await apiSend(`/api/messages/${m.id}/cancel`, 'POST');
      toast.success(`${fullName(m.contact)} won't be emailed. The rest of the run continues.`);
      refresh();
    } catch (err) {
      toast.error(err instanceof ClientError ? err.message : 'Could not cancel that send.');
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div className="space-y-4">
      <Button onClick={() => setSheet({ kind: 'pick' })} className="w-full">
        <PenLine /> Draft a new email
      </Button>

      {queued.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-muted">
            Queued to send — tap to read before it goes
          </h2>
          <ul className="space-y-2">
            {queued.map((m) => (
              <li key={m.id}>
                <button
                  onClick={() => setSheet({ kind: 'review', message: m })}
                  className="flex w-full items-center gap-3 rounded-lg border bg-surface px-3 py-3 text-left"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{fullName(m.contact)}</p>
                    <p className="truncate text-sm text-muted">{m.subject || 'No subject yet'}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <StatusPill status="queued" />
                    <span className="tabular text-xs text-muted">
                      {m.scheduledFor ? timeOfDay(m.scheduledFor) : ''}
                    </span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {isLoading ? (
        <ListSkeleton rows={4} />
      ) : error ? (
        <ErrorState message="Could not load drafts." onRetry={() => mutate()} />
      ) : all.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No drafts waiting"
          hint="Held drafts land here when the faithfulness check flags a claim. Draft a new email above to write one by hand."
        />
      ) : (
        <ul className="space-y-2">
          {all.map((m) => (
            <li key={m.id}>
              <button
                onClick={() => setSheet({ kind: 'edit', message: m })}
                className="flex w-full items-center gap-3 rounded-lg border bg-surface px-3 py-3 text-left"
              >
                {m.status === 'needs_review' && (
                  <PauseCircle className="size-5 shrink-0 text-warning" aria-hidden="true" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{fullName(m.contact)}</p>
                  <p className="truncate text-sm text-muted">{m.subject || 'No subject yet'}</p>
                  {m.checkIssues && m.checkIssues.length > 0 && (
                    <p className="mt-0.5 text-xs text-warning">
                      {m.checkIssues.length} claim{m.checkIssues.length === 1 ? '' : 's'} to fix
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <StatusPill status={m.status as PillStatus} />
                  <span className="tabular text-xs text-muted">{relativeTime(m.updatedAt)}</span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Edit / held */}
      <Sheet open={sheet?.kind === 'edit'} onOpenChange={(o) => !o && setSheet(null)}>
        <SheetContent>
          <SheetTitle>
            {sheet?.kind === 'edit' && sheet.message.status === 'needs_review'
              ? 'Held draft'
              : 'Edit draft'}
          </SheetTitle>
          <SheetDescription>Review, edit, and send when it reads right.</SheetDescription>
          {sheet?.kind === 'edit' && (
            <DraftEditor
              message={sheet.message}
              contactName={fullName(sheet.message.contact)}
              step={sheet.message.step}
              onSent={refresh}
            />
          )}
        </SheetContent>
      </Sheet>

      {/* Read-only review of a queued email, with a per-person cancel */}
      <Sheet open={sheet?.kind === 'review'} onOpenChange={(o) => !o && setSheet(null)}>
        <SheetContent>
          <SheetTitle>Queued to send</SheetTitle>
          <SheetDescription>
            This exact email will go out with the run. To change it, cancel this send and redraft.
          </SheetDescription>
          {sheet?.kind === 'review' && (
            <div className="space-y-4">
              <p className="text-sm text-muted">
                To <span className="text-ink">{fullName(sheet.message.contact)}</span>
                {sheet.message.scheduledFor
                  ? ` · around ${timeOfDay(sheet.message.scheduledFor)}`
                  : ''}
              </p>
              <div className="rounded-md border bg-bg p-4">
                <p className="font-serif text-lg font-medium">{sheet.message.subject}</p>
                <p className="font-email mt-3 whitespace-pre-wrap">{sheet.message.body}</p>
              </div>
              <Button
                variant="destructive"
                className="w-full"
                disabled={cancelling}
                onClick={() => cancelQueued(sheet.message)}
              >
                {cancelling ? <Loader2 className="animate-spin" /> : null}
                Cancel this send only
              </Button>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* New draft — contact picker then editor */}
      <Sheet open={sheet?.kind === 'pick'} onOpenChange={(o) => !o && setSheet(null)}>
        <SheetContent>
          <SheetTitle>Draft a new email</SheetTitle>
          <SheetDescription>Pick a contact and watch the draft arrive.</SheetDescription>
          <ContactPicker onPick={(contact) => setSheet({ kind: 'new', contact })} />
        </SheetContent>
      </Sheet>

      <Sheet open={sheet?.kind === 'new'} onOpenChange={(o) => !o && setSheet(null)}>
        <SheetContent>
          <SheetTitle>New draft</SheetTitle>
          <SheetDescription>Generate, edit, and send.</SheetDescription>
          {sheet?.kind === 'new' && (
            <DraftEditor
              contactId={sheet.contact.id}
              contactName={fullName(sheet.contact)}
              onSent={refresh}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function ContactPicker({ onPick }: { onPick: (c: ContactDTO) => void }) {
  const [q, setQ] = useState('');
  const key = useMemo(() => {
    const p = new URLSearchParams({ status: 'not_sent' });
    if (q.trim()) p.set('q', q.trim());
    return `/api/contacts?${p}`;
  }, [q]);
  const { data, isLoading } = useSWR<{ contacts: ContactDTO[] }>(key, fetcher);
  const contacts = data?.contacts ?? [];

  return (
    <div className="space-y-3">
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search not-yet-sent contacts"
        autoCapitalize="none"
        aria-label="Search contacts"
      />
      {isLoading ? (
        <ListSkeleton rows={4} />
      ) : contacts.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">
          No not-yet-sent contacts match. Add one in Contacts first.
        </p>
      ) : (
        <ul className="max-h-72 space-y-1 overflow-y-auto">
          {contacts.map((c) => (
            <li key={c.id}>
              <button
                onClick={() => onPick(c)}
                className="flex w-full items-center justify-between gap-2 rounded-md border bg-surface px-3 py-2.5 text-left"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{fullName(c)}</span>
                  <span className="block truncate text-sm text-muted">{c.company || c.email}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
