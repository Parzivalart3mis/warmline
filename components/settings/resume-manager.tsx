'use client';

import { useRef, useState } from 'react';
import useSWR from 'swr';
import { FileText, Upload, Loader2, Star, Check } from 'lucide-react';
import { toast } from 'sonner';
import { fetcher, apiSend, ClientError } from '@/lib/api-client';
import type { ResumeDTO } from '@/lib/types';
import { EmptyState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function ResumeManager() {
  const { data, isLoading, mutate } = useSWR<{ resumes: ResumeDTO[] }>('/api/resumes', fetcher);
  const [label, setLabel] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const resumes = data?.resumes ?? [];

  const upload = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      toast.error('Choose a PDF first.');
      return;
    }
    if (!label.trim()) {
      toast.error('Give this version a label, like “Backend”.');
      return;
    }
    const form = new FormData();
    form.set('file', file);
    form.set('label', label.trim());
    setUploading(true);
    try {
      const res = await fetch('/api/resumes', { method: 'POST', body: form });
      const json = await res.json();
      if (!res.ok)
        throw new ClientError(
          json?.error?.code ?? 'ERR',
          json?.error?.message ?? 'Upload failed.',
          res.status,
        );
      toast.success('Resume uploaded and text extracted.');
      setLabel('');
      if (fileRef.current) fileRef.current.value = '';
      await mutate();
    } catch (err) {
      toast.error(err instanceof ClientError ? err.message : 'Upload failed.');
    } finally {
      setUploading(false);
    }
  };

  const setDefault = async (id: string) => {
    try {
      await apiSend(`/api/resumes/${id}/default`, 'POST');
      toast.success('Default resume updated.');
      await mutate();
    } catch (err) {
      toast.error(err instanceof ClientError ? err.message : 'Could not set default.');
    }
  };

  return (
    <div className="space-y-3">
      {isLoading ? (
        <div className="h-16 animate-pulse rounded-md bg-border/60" />
      ) : resumes.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No resumes yet"
          hint="Upload at least one PDF — it's attached to every email and its text feeds the draft."
        />
      ) : (
        <ul className="space-y-2">
          {resumes.map((r) => (
            <li
              key={r.id}
              className="flex items-center gap-3 rounded-md border bg-surface px-3 py-2.5"
            >
              <FileText className="size-5 shrink-0 text-muted" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">
                  {r.label}
                  {r.isDefault && (
                    <span className="ml-2 inline-flex items-center gap-1 text-xs text-success">
                      <Check className="size-3" aria-hidden="true" /> default
                    </span>
                  )}
                </p>
                <p className="tabular truncate text-xs text-muted">
                  {r.fileName} · {r.textLength.toLocaleString()} chars
                </p>
              </div>
              {!r.isDefault && (
                <Button variant="ghost" size="sm" onClick={() => setDefault(r.id)}>
                  <Star className="size-4" aria-hidden="true" />
                  Make default
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-2 rounded-md border border-dashed p-3">
        <div className="space-y-1.5">
          <Label htmlFor="resume-label">New version label</Label>
          <Input
            id="resume-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Backend, ML, Full-stack…"
          />
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf"
          aria-label="Resume PDF"
          className="block w-full text-base text-muted file:mr-3 file:min-h-11 file:rounded-md file:border file:bg-surface file:px-3 file:text-base file:text-ink"
        />
        <Button onClick={upload} disabled={uploading} className="w-full">
          {uploading ? <Loader2 className="animate-spin" /> : <Upload />}
          Upload resume
        </Button>
      </div>
    </div>
  );
}
