import type { Contact, Message, Resume, Run, User } from '@/db/schema';

export type ContactDTO = Contact;
export type ResumeDTO = Omit<Resume, 'extractedText'> & { textLength: number };
export type SettingsDTO = User;

export type MessageWithContact = Message & {
  contact: { id: string; firstName: string; lastName: string; company: string; email?: string };
};

export type RunDetail = { run: Run; messages: MessageWithContact[] };

export const CONTACT_STATUSES = [
  'not_sent',
  'queued',
  'sent',
  'replied',
  'failed',
  'suppressed',
] as const;

export function fullName(c: { firstName: string; lastName: string }) {
  return `${c.firstName} ${c.lastName}`.trim();
}
