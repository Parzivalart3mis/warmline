/**
 * Sender identity guard: the From: header must always be the identity the
 * operator actually logged in as. Checked before every send, on every path.
 */
export function senderIdentityError(
  gmailUser: string | undefined,
  accountEmail: string | null | undefined,
): string | null {
  const from = gmailUser?.trim().toLowerCase();
  const account = accountEmail?.trim().toLowerCase();
  if (!from) {
    return 'GMAIL_USER is not set. Add it to your environment before sending.';
  }
  if (!account) {
    return 'No account email on file. Sign out and back in, then retry.';
  }
  if (from !== account) {
    return `GMAIL_USER (${from}) does not match the signed-in account (${account}). Sending is disabled until they match.`;
  }
  return null;
}
