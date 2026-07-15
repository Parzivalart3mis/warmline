import type { Db } from '@/lib/db';
import { events } from '@/db/schema';

type EventType =
  | 'queued'
  | 'generated'
  | 'gate_passed'
  | 'gate_flagged'
  | 'sending'
  | 'sent'
  | 'failed'
  | 'replied'
  | 'suppressed'
  | 'cancelled';

/** Append-only audit trail. Never log bodies or recipient addresses here. */
export async function appendEvent(
  db: Db,
  input: {
    userId: string;
    type: EventType;
    contactId?: string | null;
    messageId?: string | null;
    payload?: Record<string, unknown>;
  },
): Promise<void> {
  await db.insert(events).values({
    userId: input.userId,
    contactId: input.contactId ?? null,
    messageId: input.messageId ?? null,
    type: input.type,
    payload: input.payload ?? {},
  });
}
