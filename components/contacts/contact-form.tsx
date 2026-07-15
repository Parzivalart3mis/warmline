'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { apiSend, ClientError } from '@/lib/api-client';
import type { ContactDTO, ResumeDTO } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type Props = {
  resumes: ResumeDTO[];
  existing?: ContactDTO;
  onDone: () => void;
};

const DEFAULT_RESUME = '__default__';

export function ContactForm({ resumes, existing, onDone }: Props) {
  const [saving, setSaving] = useState(false);
  const [researchOptIn, setResearchOptIn] = useState(existing?.researchOptIn ?? true);
  const [resumeId, setResumeId] = useState(existing?.resumeId ?? DEFAULT_RESUME);

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const val = (k: string) => String(form.get(k) ?? '').trim();
    const tags = val('tags')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 10);

    const body: Record<string, unknown> = {
      email: val('email'),
      firstName: val('firstName'),
      lastName: val('lastName'),
      company: val('company'),
      contactRole: val('contactRole'),
      targetRole: val('targetRole'),
      jobUrl: val('jobUrl'),
      hook: val('hook'),
      linkedinUrl: val('linkedinUrl'),
      tags,
      researchOptIn,
      resumeId: resumeId === DEFAULT_RESUME ? '' : resumeId,
    };

    setSaving(true);
    try {
      if (existing) {
        await apiSend(`/api/contacts/${existing.id}`, 'PATCH', body);
        toast.success('Contact updated.');
      } else {
        await apiSend('/api/contacts', 'POST', body);
        toast.success('Contact added.');
      }
      onDone();
    } catch (err) {
      toast.error(err instanceof ClientError ? err.message : 'Could not save the contact.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="First name" name="firstName" defaultValue={existing?.firstName} required />
        <Field label="Last name" name="lastName" defaultValue={existing?.lastName ?? ''} />
      </div>
      <Field
        label="Email"
        name="email"
        type="email"
        inputMode="email"
        autoCapitalize="none"
        defaultValue={existing?.email}
        required
      />
      <Field label="Company" name="company" defaultValue={existing?.company ?? ''} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Their role" name="contactRole" defaultValue={existing?.contactRole ?? ''} />
        <Field label="Role I want" name="targetRole" defaultValue={existing?.targetRole ?? ''} />
      </div>
      <Field
        label="Job posting URL"
        name="jobUrl"
        type="url"
        inputMode="url"
        autoCapitalize="none"
        placeholder="https://…"
        defaultValue={existing?.jobUrl ?? ''}
      />
      <Field
        label="LinkedIn URL"
        name="linkedinUrl"
        type="url"
        inputMode="url"
        autoCapitalize="none"
        placeholder="https://linkedin.com/in/…"
        defaultValue={existing?.linkedinUrl ?? ''}
      />
      <div className="space-y-1.5">
        <Label htmlFor="hook">Hook note</Label>
        <Textarea
          id="hook"
          name="hook"
          rows={2}
          placeholder="One specific thing to open with."
          defaultValue={existing?.hook ?? ''}
        />
      </div>
      <Field
        label="Tags (comma-separated)"
        name="tags"
        defaultValue={(existing?.tags ?? []).join(', ')}
      />

      <div className="space-y-1.5">
        <Label>Resume version</Label>
        <Select value={resumeId} onValueChange={setResumeId}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={DEFAULT_RESUME}>Use my default</SelectItem>
            {resumes.map((r) => (
              <SelectItem key={r.id} value={r.id}>
                {r.label}
                {r.isDefault ? ' · default' : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center justify-between rounded-md border px-3 py-2.5">
        <div>
          <Label htmlFor="research" className="block">
            Research their company
          </Label>
          <p className="text-xs text-muted">Grounded facts, cached for two weeks.</p>
        </div>
        <Switch id="research" checked={researchOptIn} onCheckedChange={setResearchOptIn} />
      </div>

      <Button type="submit" size="lg" className="w-full" disabled={saving}>
        {saving ? <Loader2 className="animate-spin" /> : null}
        {existing ? 'Save changes' : 'Add contact'}
      </Button>
    </form>
  );
}

function Field({
  label,
  name,
  ...props
}: { label: string; name: string } & React.ComponentProps<typeof Input>) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} {...props} />
    </div>
  );
}
