import nodemailer, { type Transporter } from 'nodemailer';
import { MailSendError, type MailSender, type OutgoingMail, type SendReceipt } from './sender';

/**
 * Sends through smtp.gmail.com with an App Password (requires 2-Step
 * Verification on a personal @gmail.com). Messages land in the Sent folder
 * and replies arrive in the inbox — which is the entire point.
 *
 * Node runtime only. Never import from an Edge context.
 */
export class GmailSmtpSender implements MailSender {
  readonly kind = 'real' as const;
  private transporter: Transporter | null = null;

  constructor(
    private readonly user: string,
    private readonly appPassword: string,
  ) {
    if (!user || !appPassword) {
      throw new MailSendError(
        'SMTP_CONFIG',
        'GMAIL_USER and GMAIL_APP_PASSWORD must both be set to send real mail.',
      );
    }
  }

  private transport(): Transporter {
    this.transporter ??= nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: this.user, pass: this.appPassword },
    });
    return this.transporter;
  }

  async send(mail: OutgoingMail): Promise<SendReceipt> {
    if (mail.from.trim().toLowerCase() !== this.user.trim().toLowerCase()) {
      throw new MailSendError(
        'FROM_MISMATCH',
        'Refusing to send: From address does not match GMAIL_USER.',
      );
    }
    try {
      const info = await this.transport().sendMail({
        from: mail.from,
        to: mail.to,
        subject: mail.subject,
        text: mail.text,
        messageId: mail.messageId,
        ...(mail.inReplyTo ? { inReplyTo: mail.inReplyTo } : {}),
        ...(mail.references ? { references: mail.references } : {}),
        ...(mail.attachments ? { attachments: mail.attachments } : {}),
      });
      return { messageId: mail.messageId, response: String(info.response ?? 'accepted') };
    } catch (err) {
      const e = err as { responseCode?: number; code?: string; message?: string };
      const code = e.responseCode ? `SMTP_${e.responseCode}` : (e.code ?? 'SMTP_ERROR');
      if (code === 'SMTP_535' || e.responseCode === 535) {
        throw new MailSendError(
          code,
          'Gmail rejected the login. Regenerate your App Password and update GMAIL_APP_PASSWORD.',
        );
      }
      throw new MailSendError(code, e.message ?? 'SMTP send failed.');
    }
  }
}
