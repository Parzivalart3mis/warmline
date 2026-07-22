'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { fetcher, apiSend, ClientError } from '@/lib/api-client';
import type { SettingsDTO } from '@/lib/types';
import { ErrorState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { ResumeManager } from './resume-manager';

const TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Phoenix',
  'America/Toronto',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Dublin',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
  'UTC',
];

const TONES = ['warm-direct', 'formal', 'concise', 'enthusiastic', 'understated'];

export function SettingsView() {
  const { data, error, isLoading, mutate } = useSWR<{ settings: SettingsDTO }>(
    '/api/settings',
    fetcher,
  );

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (error || !data) {
    return <ErrorState message="Could not load settings." onRetry={() => mutate()} />;
  }
  return <SettingsForm settings={data.settings} onSaved={() => mutate()} />;
}

function SettingsForm({ settings, onSaved }: { settings: SettingsDTO; onSaved: () => void }) {
  const [form, setForm] = useState({
    timezone: settings.timezone,
    sendTime: settings.sendTime.slice(0, 5),
    windowStart: settings.windowStart.slice(0, 5),
    windowEnd: settings.windowEnd.slice(0, 5),
    weekdaysOnly: settings.weekdaysOnly,
    dailyCap: settings.dailyCap,
    intervalSeconds: settings.intervalSeconds,
    jitterSeconds: settings.jitterSeconds,
    followupDays: settings.followupDays,
    maxFollowups: settings.maxFollowups,
    tone: settings.tone,
    autoSelectResume: settings.autoSelectResume,
  });
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      await apiSend('/api/settings', 'PATCH', form);
      toast.success('Settings saved.');
      onSaved();
    } catch (err) {
      toast.error(err instanceof ClientError ? err.message : 'Could not save settings.');
    } finally {
      setSaving(false);
    }
  };

  const timezones = TIMEZONES.includes(form.timezone) ? TIMEZONES : [form.timezone, ...TIMEZONES];

  return (
    <div className="space-y-6">
      <Section title="Schedule" hint="When the daily drip lands, in your own timezone.">
        <FieldRow label="Timezone">
          <Select value={form.timezone} onValueChange={(v) => set('timezone', v)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {timezones.map((tz) => (
                <SelectItem key={tz} value={tz}>
                  {tz.replace('_', ' ')}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldRow>
        <FieldRow label="Send time">
          <Input
            type="time"
            value={form.sendTime}
            onChange={(e) => set('sendTime', e.target.value)}
          />
        </FieldRow>
        <div className="grid grid-cols-2 gap-3">
          <FieldRow label="Window opens">
            <Input
              type="time"
              value={form.windowStart}
              onChange={(e) => set('windowStart', e.target.value)}
            />
          </FieldRow>
          <FieldRow label="Window closes">
            <Input
              type="time"
              value={form.windowEnd}
              onChange={(e) => set('windowEnd', e.target.value)}
            />
          </FieldRow>
        </div>
        <ToggleRow
          label="Weekdays only"
          hint="Skip Saturdays and Sundays."
          checked={form.weekdaysOnly}
          onChange={(v) => set('weekdaysOnly', v)}
        />
      </Section>

      <Section title="Cadence" hint="How the drip paces itself so it never looks automated.">
        <NumberRow
          label="Daily cap"
          hint="Most emails to send in one day."
          value={form.dailyCap}
          min={1}
          max={100}
          onChange={(v) => set('dailyCap', v)}
        />
        <NumberRow
          label="Interval (seconds)"
          hint="Base gap between sends. 120 = one every two minutes."
          value={form.intervalSeconds}
          min={30}
          max={3600}
          step={10}
          onChange={(v) => set('intervalSeconds', v)}
        />
        <NumberRow
          label="Jitter (seconds)"
          hint="Random ± wobble on each gap. Must be under the interval."
          value={form.jitterSeconds}
          min={0}
          max={600}
          step={5}
          onChange={(v) => set('jitterSeconds', v)}
        />
      </Section>

      <Section title="Follow-ups" hint="Sent in the same thread if there's no reply.">
        <NumberRow
          label="Follow up after (days)"
          value={form.followupDays}
          min={1}
          max={30}
          onChange={(v) => set('followupDays', v)}
        />
        <NumberRow
          label="Max follow-ups"
          hint="Per contact, before the thread rests."
          value={form.maxFollowups}
          min={0}
          max={5}
          onChange={(v) => set('maxFollowups', v)}
        />
      </Section>

      <Section title="Voice" hint="The tone every draft is written in.">
        <FieldRow label="Tone">
          <Select value={form.tone} onValueChange={(v) => set('tone', v)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TONES.map((t) => (
                <SelectItem key={t} value={t}>
                  {t.replace('-', ' ')}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldRow>
        <ToggleRow
          label="Let AI pick the resume version"
          hint="Only when you haven't chosen one on the contact. Uses the target role and job posting."
          checked={form.autoSelectResume}
          onChange={(v) => set('autoSelectResume', v)}
        />
      </Section>

      <div className="sticky bottom-24 z-10">
        <Button onClick={save} size="lg" className="w-full shadow-sm" disabled={saving}>
          {saving ? <Loader2 className="animate-spin" /> : null}
          Save settings
        </Button>
      </div>

      <Section title="Resumes" hint="Attached to every email; the text feeds the draft.">
        <ResumeManager />
      </Section>
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-sm text-muted">{hint}</p>
      </div>
      <div className="space-y-3 rounded-lg border bg-surface p-4">{children}</div>
    </section>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function NumberRow({
  label,
  hint,
  value,
  onChange,
  min,
  max,
  step,
}: {
  label: string;
  hint?: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <Label>{label}</Label>
        {hint && <p className="text-xs text-muted">{hint}</p>}
      </div>
      <Input
        type="number"
        inputMode="numeric"
        value={value}
        min={min}
        max={max}
        step={step ?? 1}
        onChange={(e) => onChange(Number(e.target.value))}
        className="tabular w-24 text-right"
        aria-label={label}
      />
    </div>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <Label>{label}</Label>
        {hint && <p className="text-xs text-muted">{hint}</p>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </div>
  );
}
