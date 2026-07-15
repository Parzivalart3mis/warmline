import { describe, it, expect, vi } from 'vitest';
import { GmailSmtpSender } from '@/lib/mail/gmail-smtp';
import { MailSendError } from '@/lib/mail/sender';
import { rfcMessageId } from '@/lib/mail';

const hoisted = vi.hoisted(() => ({ sendMail: vi.fn() }));

vi.mock('nodemailer', () => ({
  default: { createTransport: () => ({ sendMail: hoisted.sendMail }) },
}));

describe('GmailSmtpSender', () => {
  const mail = {
    from: 'me@gmail.com',
    to: 'them@example.com',
    subject: 'Hi',
    text: 'Body',
    messageId: rfcMessageId('abc'),
  };

  it('refuses to construct without credentials', () => {
    expect(() => new GmailSmtpSender('', '')).toThrow(MailSendError);
  });

  it('refuses to send from an address other than GMAIL_USER', async () => {
    hoisted.sendMail.mockReset();
    const sender = new GmailSmtpSender('me@gmail.com', 'app-pass');
    await expect(sender.send({ ...mail, from: 'someone-else@gmail.com' })).rejects.toMatchObject({
      code: 'FROM_MISMATCH',
    });
    expect(hoisted.sendMail).not.toHaveBeenCalled();
  });

  it('sends and returns a receipt with our message id', async () => {
    hoisted.sendMail.mockReset();
    hoisted.sendMail.mockResolvedValue({ response: '250 OK' });
    const sender = new GmailSmtpSender('me@gmail.com', 'app-pass');
    const receipt = await sender.send(mail);
    expect(receipt.messageId).toBe(rfcMessageId('abc'));
    expect(receipt.response).toBe('250 OK');
    expect(hoisted.sendMail).toHaveBeenCalledOnce();
  });

  it('maps a 535 auth failure to an actionable message', async () => {
    hoisted.sendMail.mockReset();
    hoisted.sendMail.mockRejectedValue({ responseCode: 535, message: 'bad creds' });
    const sender = new GmailSmtpSender('me@gmail.com', 'app-pass');
    await expect(sender.send(mail)).rejects.toMatchObject({ code: 'SMTP_535' });
    await expect(sender.send(mail)).rejects.toThrow(/Regenerate your App Password/);
  });

  it('wraps other SMTP failures with their code', async () => {
    hoisted.sendMail.mockReset();
    hoisted.sendMail.mockRejectedValue({ responseCode: 550, message: 'no such user' });
    const sender = new GmailSmtpSender('me@gmail.com', 'app-pass');
    await expect(sender.send(mail)).rejects.toMatchObject({ code: 'SMTP_550' });
  });

  it('exposes its kind as real', () => {
    expect(new GmailSmtpSender('me@gmail.com', 'p').kind).toBe('real');
  });
});

describe('rfcMessageId', () => {
  it('wraps an id in angle brackets at the warmline domain', () => {
    expect(rfcMessageId('abc123')).toBe('<abc123@warmline.app>');
  });
});
