/**
 * The send path abstraction. GmailSmtpSender is the production implementation
 * (personal @gmail.com + App Password). If the account turns out to be Google
 * Workspace, App Passwords are unavailable and a GmailOAuthSender must replace
 * it — this interface makes that a one-file change.
 */
export type MailAttachment = {
  filename: string;
  /** File path or https URL (nodemailer streams URLs). */
  path: string;
};

export type OutgoingMail = {
  from: string;
  to: string;
  subject: string;
  /** Plain text only. No HTML anywhere in the send path. */
  text: string;
  /** Our own deterministic RFC Message-ID, e.g. `<cuid@warmline.app>`. */
  messageId: string;
  inReplyTo?: string;
  references?: string;
  attachments?: MailAttachment[];
};

export type SendReceipt = {
  /** The RFC Message-ID the mail went out with. */
  messageId: string;
  /** Transport response line (safe to log — no payload). */
  response: string;
};

export class MailSendError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'MailSendError';
    this.code = code;
  }
}

export interface MailSender {
  /** Whether this sender hits the network ('real') or an in-process outbox ('fake'). */
  readonly kind: 'real' | 'fake';
  send(mail: OutgoingMail): Promise<SendReceipt>;
}
