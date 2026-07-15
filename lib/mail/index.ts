import type { MailSender } from './sender';
import { GmailSmtpSender } from './gmail-smtp';
import { fakeMailSender } from './fake';

/**
 * Real SMTP only in production, or when ENABLE_REAL_SMTP=1 is set explicitly.
 * Everything else — dev, preview, CI — uses the fake sender. CI must never
 * send real mail.
 */
export function getMailSender(): MailSender {
  const wantsReal =
    process.env.ENABLE_REAL_SMTP === '1' ||
    (process.env.NODE_ENV === 'production' && process.env.VERCEL_ENV === 'production');

  if (wantsReal) {
    return new GmailSmtpSender(process.env.GMAIL_USER ?? '', process.env.GMAIL_APP_PASSWORD ?? '');
  }
  return fakeMailSender();
}

export function rfcMessageId(messageId: string): string {
  return `<${messageId}@warmline.app>`;
}
