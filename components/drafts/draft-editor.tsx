'use client';

import { useState } from 'react';
import { experimental_useObject as useObject } from '@ai-sdk/react';
import { Sparkles, Send, Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';
import { draftSchema } from '@/lib/ai/draft';
import { apiSend, ClientError } from '@/lib/api-client';
import type { MessageWithContact } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { FlaggedBody } from './flagged-body';

type Props = {
  /** Generate mode: draft a fresh email for this contact. */
  contactId?: string;
  contactName?: string;
  /** Edit mode: an existing draft or held message. */
  message?: MessageWithContact;
  step?: number;
  onSent: () => void;
};

/**
 * §7.2 individual-send path with a streaming draft. The thing being written
 * is a letter, so subject + body render in Newsreader and stay selectable.
 * While the model streams, partials flow straight into the fields so the
 * operator watches the letter arrive; on finish they become editable.
 */
export function DraftEditor({ contactId, contactName, message, step = 1, onSent }: Props) {
  const [subject, setSubject] = useState(message?.subject ?? '');
  const [body, setBody] = useState(message?.body ?? '');
  const [messageId, setMessageId] = useState(message?.id ?? null);
  const [sending, setSending] = useState(false);
  const [saving, setSaving] = useState(false);

  const targetContactId = contactId ?? message?.contact.id;
  const heldIssues = message?.checkIssues ?? [];

  const { submit, object, isLoading, error } = useObject({
    api: '/api/messages/generate',
    schema: draftSchema,
    fetch: async (input, init) => {
      const res = await fetch(input, init);
      const id = res.headers.get('x-message-id');
      if (id) setMessageId(id);
      return res;
    },
    onFinish: ({ object: final }) => {
      // Copy the settled draft into editable state (event callback, not an
      // effect — no cascading renders).
      if (final) {
        setSubject(final.subject);
        setBody(final.body);
      }
    },
  });

  const streaming = isLoading;
  // While streaming, show the partial object live; once settled, the local
  // editable state (filled by onFinish) takes over.
  const shownSubject = streaming ? (object?.subject ?? '') : subject;
  const shownBody = streaming ? (object?.body ?? '') : body;

  const generate = () => {
    if (!targetContactId) return;
    setSubject('');
    setBody('');
    submit({ contactId: targetContactId, step });
  };

  const persist = async () => {
    if (!messageId) throw new ClientError('NO_DRAFT', 'Generate or write the draft first.', 400);
    const res = await apiSend<{ message: MessageWithContact }>(
      `/api/messages/${messageId}`,
      'PATCH',
      { subject, body },
    );
    return res.message;
  };

  const save = async () => {
    setSaving(true);
    try {
      const saved = await persist();
      setSubject(saved.subject);
      setBody(saved.body);
      toast.success('Draft saved.');
    } catch (err) {
      toast.error(err instanceof ClientError ? err.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  };

  const sendNow = async () => {
    setSending(true);
    try {
      await persist(); // send-now re-runs the faithfulness gate on this exact text
      await apiSend(`/api/messages/${messageId}/send-now`, 'POST');
      toast.success('Sent.');
      onSent();
    } catch (err) {
      const e = err instanceof ClientError ? err : null;
      toast.error(e?.message ?? 'The send failed.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-4">
      {contactName && (
        <p className="text-sm text-muted">
          To <span className="text-ink">{contactName}</span>
          {step > 1 ? ` · follow-up ${step - 1}` : ''}
        </p>
      )}

      {heldIssues.length > 0 && (
        <div className="rounded-md border border-warning/30 bg-[color-mix(in_srgb,var(--warning)_7%,transparent)] p-3">
          <p className="mb-2 text-sm font-medium">Held by the faithfulness check</p>
          <FlaggedBody body={message?.body ?? body} issues={heldIssues} />
          <p className="mt-2 text-xs text-muted">
            Edit the highlighted claims below until they are supported, then send.
          </p>
        </div>
      )}

      {targetContactId && (
        <Button variant="secondary" onClick={generate} disabled={isLoading} className="w-full">
          {isLoading ? <Loader2 className="animate-spin" /> : <Sparkles />}
          {isLoading ? 'Drafting…' : subject || body ? 'Regenerate draft' : 'Generate draft'}
        </Button>
      )}

      {error && (
        <p className="text-sm text-error" role="alert">
          The draft stream failed. Try generating again.
        </p>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="subject">Subject</Label>
        <Input
          id="subject"
          value={shownSubject}
          onChange={(e) => setSubject(e.target.value)}
          readOnly={streaming}
          className="font-serif"
          placeholder={streaming ? 'Writing…' : 'Subject line'}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="body">Body</Label>
        {/* Serif, and selectable — the operator must be able to copy a draft. */}
        <Textarea
          id="body"
          value={shownBody}
          onChange={(e) => setBody(e.target.value)}
          readOnly={streaming}
          rows={12}
          className="font-email"
          placeholder={streaming ? 'The letter is arriving…' : 'Dear …'}
        />
      </div>

      <div className="flex gap-2">
        <Button
          variant="secondary"
          onClick={save}
          disabled={saving || !messageId || isLoading}
          className="flex-1"
        >
          {saving ? <Loader2 className="animate-spin" /> : <Save />}
          Save
        </Button>
        <Button
          onClick={sendNow}
          disabled={sending || isLoading || !messageId || !subject || !body}
          className="flex-1"
        >
          {sending ? <Loader2 className="animate-spin" /> : <Send />}
          Send now
        </Button>
      </div>
    </div>
  );
}
