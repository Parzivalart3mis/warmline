'use client';

import { useState } from 'react';
import { MoreVertical, Send, Reply, Ban, Pencil, Trash2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { apiSend, ClientError } from '@/lib/api-client';
import type { ContactDTO } from '@/lib/types';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

type Props = {
  contact: ContactDTO;
  onEdit: () => void;
  onChanged: () => void;
};

export function ContactActions({ contact, onEdit, onChanged }: Props) {
  const [confirm, setConfirm] = useState<null | 'suppress' | 'delete'>(null);
  const [busy, setBusy] = useState(false);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
      onChanged();
    } catch (err) {
      toast.error(err instanceof ClientError ? err.message : 'That action failed.');
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  const canReply = contact.status === 'sent';
  const canSend = ['not_sent', 'failed'].includes(contact.status);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Actions for ${contact.firstName}`}
          className="ui-chrome flex size-11 items-center justify-center rounded-md text-muted active:bg-bg"
        >
          <MoreVertical className="size-5" aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {canSend && (
            <DropdownMenuItem
              onSelect={() =>
                act(
                  () => apiSend('/api/runs', 'POST', { kind: 'manual', contactIds: [contact.id] }),
                  'Queued a run for this contact.',
                )
              }
            >
              <Send className="size-4" aria-hidden="true" />
              Send to just this contact
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={onEdit}>
            <Pencil className="size-4" aria-hidden="true" />
            Edit
          </DropdownMenuItem>
          {canReply && (
            <DropdownMenuItem
              onSelect={() =>
                act(
                  () => apiSend(`/api/contacts/${contact.id}/replied`, 'POST'),
                  'Marked replied. Pending follow-ups cancelled.',
                )
              }
            >
              <Reply className="size-4" aria-hidden="true" />
              Mark replied
            </DropdownMenuItem>
          )}
          {!contact.suppressed && (
            <DropdownMenuItem onSelect={() => setConfirm('suppress')}>
              <Ban className="size-4" aria-hidden="true" />
              Suppress
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => setConfirm('delete')} className="text-error">
            <Trash2 className="size-4" aria-hidden="true" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          <DialogTitle>
            {confirm === 'suppress' ? 'Suppress this contact?' : 'Delete this contact?'}
          </DialogTitle>
          <DialogDescription>
            {confirm === 'suppress'
              ? `${contact.firstName} will never be emailed again by anything — the daily drip, follow-ups, or a manual send.`
              : `This permanently removes ${contact.firstName} and their message history. Suppressing instead keeps the record but stops all mail.`}
          </DialogDescription>
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setConfirm(null)}>
              Keep
            </Button>
            <Button
              variant="destructive"
              className="flex-1"
              disabled={busy}
              onClick={() =>
                confirm === 'suppress'
                  ? act(
                      () => apiSend(`/api/contacts/${contact.id}/suppress`, 'POST', {}),
                      'Contact suppressed. They will never be emailed again.',
                    )
                  : act(() => apiSend(`/api/contacts/${contact.id}`, 'DELETE'), 'Contact deleted.')
              }
            >
              {busy ? <Loader2 className="animate-spin" /> : null}
              {confirm === 'suppress' ? 'Suppress' : 'Delete'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
