'use client';

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { Send, Inbox, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { fetcher, apiSend, ClientError } from '@/lib/api-client';
import type { RunDetail, MessageWithContact, SettingsDTO } from '@/lib/types';
import type { Run } from '@/db/schema';
import { fullName } from '@/lib/types';
import { StatusPill, type PillStatus } from '@/components/status-pill';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { timeOfDay, initials } from '@/lib/format';
import { HairlineSweep } from './hairline-row';

const ACTIVE = new Set(['planning', 'waiting', 'sending']);
/** Statuses that can still be pulled out of a run without touching the rest. */
const ROW_CANCELLABLE = new Set(['draft', 'queued']);

export function QueueBoard() {
  const {
    data: runsData,
    error: runsError,
    isLoading: runsLoading,
    mutate: refetchRuns,
  } = useSWR<{
    runs: Run[];
  }>('/api/runs', fetcher, { refreshInterval: 15_000 });
  const { data: settings } = useSWR<{ settings: SettingsDTO }>('/api/settings', fetcher);

  const activeRun = useMemo(() => {
    const runs = runsData?.runs ?? [];
    return runs.find((r) => ACTIVE.has(r.status)) ?? runs[0] ?? null;
  }, [runsData]);

  const isActive = activeRun ? ACTIVE.has(activeRun.status) : false;
  const {
    data: detail,
    error: detailError,
    mutate: refetchDetail,
  } = useSWR<RunDetail>(activeRun ? `/api/runs/${activeRun.id}` : null, fetcher, {
    refreshInterval: isActive ? 5_000 : 0,
  });

  const [starting, setStarting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [dropTarget, setDropTarget] = useState<MessageWithContact | null>(null);
  const [dropping, setDropping] = useState(false);

  const intervalMs = (settings?.settings.intervalSeconds ?? 120) * 1000;

  const startRun = async () => {
    setStarting(true);
    try {
      await apiSend('/api/runs', 'POST', { kind: 'manual' });
      toast.success('Run started. A digest is on its way, then a 10-minute grace period.');
      await refetchRuns();
    } catch (err) {
      toast.error(err instanceof ClientError ? err.message : 'Could not start the run.');
    } finally {
      setStarting(false);
    }
  };

  const cancelRun = async () => {
    if (!activeRun) return;
    setCancelling(true);
    try {
      await apiSend(`/api/runs/${activeRun.id}/cancel`, 'POST');
      toast.success('Run cancelled. Nothing further will send.');
      await Promise.all([refetchRuns(), refetchDetail()]);
    } catch (err) {
      toast.error(err instanceof ClientError ? err.message : 'Could not cancel the run.');
    } finally {
      setCancelling(false);
    }
  };

  /** Pull ONE person out of the run; everyone else keeps sending. */
  const dropOne = async () => {
    if (!dropTarget) return;
    setDropping(true);
    try {
      await apiSend(`/api/messages/${dropTarget.id}/cancel`, 'POST');
      toast.success(
        `${fullName(dropTarget.contact)} removed from this run. The rest continue as planned.`,
      );
      setDropTarget(null);
      await refetchDetail();
    } catch (err) {
      toast.error(err instanceof ClientError ? err.message : 'Could not remove them.');
    } finally {
      setDropping(false);
    }
  };

  if (runsLoading) return <ListSkeleton rows={6} />;
  if (runsError) {
    return <ErrorState message="Could not load your runs." onRetry={() => refetchRuns()} />;
  }
  if (!activeRun) {
    return (
      <EmptyState
        icon={Inbox}
        title="No runs yet"
        hint="Start a run to draft and drip today's outreach, one email every couple of minutes."
        action={
          <Button onClick={startRun} disabled={starting}>
            {starting ? <Loader2 className="animate-spin" /> : <Send />}
            Start a run
          </Button>
        }
      />
    );
  }

  const messages = detail?.messages ?? [];
  const sent = messages.filter((m) => m.status === 'sent').length;
  const waiting = messages.filter((m) => ['queued', 'draft'].includes(m.status)).length;
  const sendingMsg = messages.find((m) => m.status === 'sending');
  const canCancel = ACTIVE.has(activeRun.status) && !activeRun.cancelled;
  const runIsLive = ACTIVE.has(activeRun.status) && !activeRun.cancelled;

  return (
    <div className="space-y-4">
      <RunSummary
        run={activeRun}
        sent={sent}
        waiting={waiting}
        canCancel={canCancel}
        cancelling={cancelling}
        onCancel={cancelRun}
        onStart={startRun}
        starting={starting}
      />

      {sendingMsg && (
        <p className="sr-only" aria-live="polite">
          Now sending to {fullName(sendingMsg.contact)} at {sendingMsg.contact.company}.
        </p>
      )}

      {detailError ? (
        <ErrorState message="Could not load this run's messages." onRetry={() => refetchDetail()} />
      ) : messages.length === 0 ? (
        <EmptyState
          icon={Send}
          title="Nothing queued in this run"
          hint="Every eligible contact was already sent, suppressed, or replied. Add contacts to send more."
        />
      ) : (
        <ol className="overflow-hidden rounded-lg border">
          {messages.map((m, i) => (
            <QueueRow
              key={m.id}
              message={m}
              intervalMs={intervalMs}
              last={i === messages.length - 1}
              canDrop={runIsLive && ROW_CANCELLABLE.has(m.status)}
              onDrop={() => setDropTarget(m)}
            />
          ))}
        </ol>
      )}

      <Dialog open={dropTarget !== null} onOpenChange={(o) => !o && setDropTarget(null)}>
        <DialogContent>
          <DialogTitle>
            Remove {dropTarget ? fullName(dropTarget.contact) : 'this contact'} from the run?
          </DialogTitle>
          <DialogDescription>
            Only this email is cancelled — everyone else in the run still sends. The contact goes
            back to “Not sent”, so you can email them another day with a different angle.
          </DialogDescription>
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setDropTarget(null)}>
              Keep them in
            </Button>
            <Button variant="destructive" className="flex-1" disabled={dropping} onClick={dropOne}>
              {dropping ? <Loader2 className="animate-spin" /> : null}
              Remove from run
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RunSummary({
  run,
  sent,
  waiting,
  canCancel,
  cancelling,
  onCancel,
  onStart,
  starting,
}: {
  run: Run;
  sent: number;
  waiting: number;
  canCancel: boolean;
  cancelling: boolean;
  onCancel: () => void;
  onStart: () => void;
  starting: boolean;
}) {
  const label =
    run.status === 'waiting'
      ? 'Waiting — digest sent, grace period running'
      : run.status === 'sending'
        ? 'Sending'
        : run.status === 'planning'
          ? 'Planning'
          : run.status === 'cancelled'
            ? 'Cancelled'
            : run.status === 'failed'
              ? 'Failed'
              : 'Done';

  return (
    <div className="rounded-lg border bg-surface p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm text-muted">
            {run.kind === 'daily' ? "Today's run" : 'Manual run'}
          </p>
          <p className="tabular text-2xl">
            {sent}
            <span className="text-muted"> reached</span>
            {waiting > 0 && (
              <>
                {' · '}
                {waiting}
                <span className="text-muted"> waiting</span>
              </>
            )}
          </p>
        </div>
        <span className="tabular text-xs text-muted">{label}</span>
      </div>
      <div className="mt-3 flex gap-2">
        {canCancel ? (
          <Button variant="destructive" size="sm" onClick={onCancel} disabled={cancelling}>
            {cancelling ? <Loader2 className="animate-spin" /> : null}
            Cancel run
          </Button>
        ) : (
          <Button variant="secondary" size="sm" onClick={onStart} disabled={starting}>
            {starting ? <Loader2 className="animate-spin" /> : <Send />}
            Start a run
          </Button>
        )}
      </div>
    </div>
  );
}

function QueueRow({
  message,
  intervalMs,
  last,
  canDrop,
  onDrop,
}: {
  message: MessageWithContact;
  intervalMs: number;
  last: boolean;
  canDrop: boolean;
  onDrop: () => void;
}) {
  const sending = message.status === 'sending';

  return (
    <li className={`relative bg-surface ${last ? '' : 'border-b'}`}>
      <div className="flex items-center gap-3 px-4 py-3">
        <span
          aria-hidden="true"
          className="tabular flex size-9 shrink-0 items-center justify-center rounded-xl border text-xs text-muted"
        >
          {initials(message.contact.firstName, message.contact.lastName)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{fullName(message.contact)}</p>
          <p className="truncate text-sm text-muted">
            {message.contact.company}
            {message.step > 1 ? ` · follow-up ${message.step - 1}` : ''}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <StatusPill status={message.status as PillStatus} />
          <span className="tabular text-xs text-muted">
            {message.status === 'sent'
              ? timeOfDay(message.sentAt)
              : message.scheduledFor
                ? timeOfDay(message.scheduledFor)
                : ''}
          </span>
        </div>
        {canDrop && (
          <button
            onClick={onDrop}
            aria-label={`Remove ${fullName(message.contact)} from this run`}
            className="ui-chrome flex size-11 shrink-0 items-center justify-center rounded-md text-muted active:bg-bg"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        )}
      </div>
      {sending && <HairlineSweep intervalMs={intervalMs} />}
    </li>
  );
}
