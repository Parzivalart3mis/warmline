'use client';

import { useState } from 'react';
import { Loader2, AlertCircle, Check } from 'lucide-react';
import { toast } from 'sonner';
import { apiSend, ClientError } from '@/lib/api-client';
import { parseContactsImport } from '@/lib/csv';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

/**
 * Two-step import: parse locally and let the operator review the rows and
 * the row errors, THEN commit. Nothing is sent to the server until review.
 */
export function CsvImport({ onDone }: { onDone: () => void }) {
  const [raw, setRaw] = useState('');
  const [parsed, setParsed] = useState<ReturnType<typeof parseContactsImport> | null>(null);
  const [committing, setCommitting] = useState(false);

  const review = () => {
    const result = parseContactsImport(raw);
    setParsed(result);
    if (result.rows.length === 0) {
      toast.error(result.errors[0]?.message ?? 'Nothing valid to import.');
    }
  };

  const commit = async () => {
    if (!parsed || parsed.rows.length === 0) return;
    setCommitting(true);
    try {
      const rows = parsed.rows.map((r) => ({
        email: r.values.email ?? '',
        firstName: r.values.firstName ?? '',
        lastName: r.values.lastName ?? '',
        company: r.values.company ?? '',
        contactRole: r.values.contactRole ?? '',
        targetRole: r.values.targetRole ?? '',
        jobUrl: r.values.jobUrl ?? '',
        hook: r.values.hook ?? '',
        linkedinUrl: r.values.linkedinUrl ?? '',
        tags: (r.values.tags ?? '')
          .split(/[;|]/)
          .map((t) => t.trim())
          .filter(Boolean)
          .slice(0, 10),
        source: 'csv' as const,
      }));
      const res = await apiSend<{ created: number; skipped: number }>(
        '/api/contacts/import',
        'POST',
        { rows },
      );
      toast.success(
        `Imported ${res.created} contact${res.created === 1 ? '' : 's'}${
          res.skipped ? `, skipped ${res.skipped} duplicate${res.skipped === 1 ? '' : 's'}` : ''
        }.`,
      );
      onDone();
    } catch (err) {
      toast.error(err instanceof ClientError ? err.message : 'Import failed.');
    } finally {
      setCommitting(false);
    }
  };

  if (!parsed) {
    return (
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="csv">Paste CSV or a block of rows</Label>
          <Textarea
            id="csv"
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            rows={8}
            placeholder={'email,first name,company,role\nada@acme.com,Ada,Acme,Backend Engineer'}
            className="font-mono text-sm"
          />
          <p className="text-xs text-muted">
            First row must be a header including an email column. Quoted commas are fine.
          </p>
        </div>
        <Button onClick={review} disabled={raw.trim() === ''} className="w-full">
          Review rows
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm">
        <Check className="size-4 text-success" aria-hidden="true" />
        <span>
          {parsed.rows.length} ready to import
          {parsed.duplicates > 0 ? ` · ${parsed.duplicates} duplicates skipped` : ''}
        </span>
      </div>

      <ol className="max-h-64 space-y-1 overflow-y-auto rounded-md border p-2">
        {parsed.rows.map((r) => (
          <li key={r.line} className="flex items-baseline justify-between gap-2 px-1 py-1 text-sm">
            <span className="truncate">
              {r.values.firstName} {r.values.lastName}
              {r.values.company ? ` · ${r.values.company}` : ''}
            </span>
            <span className="tabular shrink-0 text-xs text-muted">{r.values.email}</span>
          </li>
        ))}
      </ol>

      {parsed.errors.length > 0 && (
        <ul className="space-y-1 rounded-md border border-warning/30 bg-[color-mix(in_srgb,var(--warning)_7%,transparent)] p-2 text-xs">
          {parsed.errors.slice(0, 8).map((e, i) => (
            <li key={i} className="flex items-start gap-1.5 text-ink">
              <AlertCircle className="mt-0.5 size-3 shrink-0 text-warning" aria-hidden="true" />
              {e.message}
            </li>
          ))}
        </ul>
      )}

      <div className="flex gap-2">
        <Button variant="secondary" onClick={() => setParsed(null)} className="flex-1">
          Back
        </Button>
        <Button
          onClick={commit}
          disabled={committing || parsed.rows.length === 0}
          className="flex-1"
        >
          {committing ? <Loader2 className="animate-spin" /> : null}
          Import {parsed.rows.length}
        </Button>
      </div>
    </div>
  );
}
