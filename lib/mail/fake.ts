import type { MailSender, OutgoingMail, SendReceipt } from './sender';

/**
 * Dev/preview/CI sender. Never touches the network. Keeps an in-process
 * outbox so local E2E flows can assert on what "went out".
 */
export class FakeMailSender implements MailSender {
  readonly kind = 'fake' as const;
  readonly outbox: OutgoingMail[] = [];

  async send(mail: OutgoingMail): Promise<SendReceipt> {
    this.outbox.push(mail);
    // Never log bodies or recipients — message id and counts only.
    console.log(`[fake-mail] sent ${mail.messageId} (outbox size ${this.outbox.length})`);
    return { messageId: mail.messageId, response: 'fake: accepted' };
  }
}

const globalForOutbox = globalThis as unknown as { __warmlineFakeSender?: FakeMailSender };

/** Single shared instance per process so routes and engine see one outbox. */
export function fakeMailSender(): FakeMailSender {
  globalForOutbox.__warmlineFakeSender ??= new FakeMailSender();
  return globalForOutbox.__warmlineFakeSender;
}
