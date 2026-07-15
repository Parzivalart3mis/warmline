/**
 * §14.1 SMTP spike — run BEFORE building on top of the send path:
 *
 *   pnpm tsx scripts/smtp-spike.ts
 *
 * Requires GMAIL_USER and GMAIL_APP_PASSWORD in .env.local (2-Step
 * Verification on, App Password generated at myaccount.google.com/apppasswords).
 * Sends one real email from you, to you. Then verify by hand:
 *   1. It arrives in your inbox.
 *   2. It appears in your Gmail SENT folder.
 *   3. Replying to it lands the reply in your inbox, threaded.
 *
 * If this fails with SMTP_535 on a Google Workspace account, App Passwords
 * are unavailable — the MailSender interface swaps to OAuth in one file.
 */
import { config } from 'dotenv';
import { createId } from '@paralleldrive/cuid2';
import { GmailSmtpSender } from '../lib/mail/gmail-smtp';
import { rfcMessageId } from '../lib/mail';

config({ path: '.env.local' });
config();

async function main() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    console.error('Set GMAIL_USER and GMAIL_APP_PASSWORD in .env.local first.');
    process.exit(1);
  }

  const sender = new GmailSmtpSender(user, pass);
  const id = rfcMessageId(createId());
  console.log(`Sending spike email ${id} from ${user} to ${user}…`);

  const receipt = await sender.send({
    from: user,
    to: user,
    subject: 'Warmline SMTP spike — it works',
    text: [
      'This email was sent by scripts/smtp-spike.ts through smtp.gmail.com:465',
      'with your App Password.',
      '',
      'Checklist:',
      '  [ ] This arrived in your inbox.',
      '  [ ] It shows in your Gmail Sent folder.',
      '  [ ] Reply to it and confirm the reply threads in your inbox.',
      '',
      'If all three pass, the Warmline send path is proven.',
    ].join('\n'),
    messageId: id,
  });

  console.log(`Accepted: ${receipt.response}`);
  console.log('Now check your inbox and your Sent folder.');
}

main().catch((err) => {
  console.error(`Spike failed: ${err.code ?? ''} ${err.message}`);
  console.error('If this is a Google Workspace account, pivot to GmailOAuthSender (see README).');
  process.exit(1);
});
