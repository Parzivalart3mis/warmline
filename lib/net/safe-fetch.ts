import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * SSRF-guarded fetch for operator-pasted job URLs — the app's main attack
 * surface. https only, DNS resolved and checked against private/reserved
 * ranges BEFORE any connection, re-checked after every redirect (max 3),
 * 5s deadline, 2MB streamed cap, text-only content types. Raw upstream
 * errors are never surfaced to the client.
 */
export type SafeFetchErrorCode =
  | 'BLOCKED_URL'
  | 'BLOCKED_IP'
  | 'TOO_MANY_REDIRECTS'
  | 'TIMEOUT'
  | 'TOO_LARGE'
  | 'BAD_CONTENT_TYPE'
  | 'FETCH_FAILED';

export class SafeFetchError extends Error {
  readonly code: SafeFetchErrorCode;

  constructor(code: SafeFetchErrorCode, message: string) {
    super(message);
    this.name = 'SafeFetchError';
    this.code = code;
  }
}

export type SafeFetchDeps = {
  fetchImpl?: typeof fetch;
  lookupImpl?: (hostname: string) => Promise<Array<{ address: string }>>;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
};

const defaultLookup = async (hostname: string) => lookup(hostname, { all: true });

function ipv4Octets(ip: string): number[] | null {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return null;
  }
  return parts;
}

function isPrivateIpv4(octets: number[]): boolean {
  const [a = -1, b = -1] = octets;
  if (a === 0) return true; // 0.0.0.0/8, incl. 0.0.0.0
  if (a === 127) return true; // loopback
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true; // link-local / cloud metadata
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast + reserved + broadcast
  return false;
}

/** Expand an IPv6 literal to its 8 groups; null if unparseable. */
function ipv6Groups(ip: string): number[] | null {
  let s = (ip.split('%')[0] ?? '').toLowerCase();
  if (s.includes('.')) {
    // Embedded IPv4 tail (e.g. ::ffff:10.0.0.1) → two hex groups.
    const i = s.lastIndexOf(':');
    const v4 = ipv4Octets(s.slice(i + 1));
    if (!v4) return null;
    const [o0 = 0, o1 = 0, o2 = 0, o3 = 0] = v4;
    s = `${s.slice(0, i + 1)}${((o0 << 8) | o1).toString(16)}:${((o2 << 8) | o3).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const groups =
    halves.length === 2
      ? [...head, ...Array(Math.max(0, 8 - head.length - tail.length)).fill('0'), ...tail]
      : head;
  if (groups.length !== 8) return null;
  const nums = groups.map((g) => Number.parseInt(g || '0', 16));
  if (nums.some((n) => Number.isNaN(n) || n < 0 || n > 0xffff)) return null;
  return nums;
}

export function isBlockedAddress(ip: string): boolean {
  const kind = isIP(ip.split('%')[0] ?? ip);
  if (kind === 4) {
    const octets = ipv4Octets(ip);
    return octets ? isPrivateIpv4(octets) : true;
  }
  if (kind === 6) {
    const g = ipv6Groups(ip);
    if (!g) return true;
    const [g0 = 0, , , , , g5 = 0, g6 = 0, g7 = 0] = g;
    if (g.every((n) => n === 0)) return true; // :: unspecified
    if (g.slice(0, 7).every((n) => n === 0) && g7 === 1) return true; // ::1
    if ((g0 & 0xfe00) === 0xfc00) return true; // fc00::/7 ULA
    if ((g0 & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    if (g0 >>> 8 === 0xff) return true; // ff00::/8 multicast
    if (g.slice(0, 5).every((n) => n === 0) && g5 === 0xffff) {
      // IPv4-mapped — judge the embedded IPv4.
      return isPrivateIpv4([g6 >>> 8, g6 & 0xff, g7 >>> 8, g7 & 0xff]);
    }
    return false;
  }
  return true; // not an IP literal — caller resolves first
}

async function assertHostAllowed(url: URL, deps: Required<Pick<SafeFetchDeps, 'lookupImpl'>>) {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host)) {
    if (isBlockedAddress(host)) {
      throw new SafeFetchError('BLOCKED_IP', 'That URL points at a private or reserved address.');
    }
    return;
  }
  let addresses: Array<{ address: string }>;
  try {
    addresses = await deps.lookupImpl(host);
  } catch {
    throw new SafeFetchError('FETCH_FAILED', 'That URL could not be resolved.');
  }
  if (addresses.length === 0) {
    throw new SafeFetchError('FETCH_FAILED', 'That URL could not be resolved.');
  }
  for (const { address } of addresses) {
    if (isBlockedAddress(address)) {
      throw new SafeFetchError('BLOCKED_IP', 'That URL points at a private or reserved address.');
    }
  }
}

function assertUrlShape(raw: string | URL): URL {
  let url: URL;
  try {
    url = raw instanceof URL ? raw : new URL(raw);
  } catch {
    throw new SafeFetchError('BLOCKED_URL', 'That is not a valid URL.');
  }
  if (url.protocol !== 'https:') {
    throw new SafeFetchError('BLOCKED_URL', 'Only https URLs can be fetched.');
  }
  if (url.username || url.password) {
    throw new SafeFetchError('BLOCKED_URL', 'URLs with embedded credentials are not allowed.');
  }
  return url;
}

const ALLOWED_CONTENT_TYPES = ['text/html', 'text/plain'];

export async function safeFetchText(rawUrl: string, deps: SafeFetchDeps = {}): Promise<string> {
  const {
    fetchImpl = fetch,
    lookupImpl = defaultLookup,
    timeoutMs = 5_000,
    maxBytes = 2 * 1024 * 1024,
    maxRedirects = 3,
  } = deps;

  const deadline = Date.now() + timeoutMs;
  let url = assertUrlShape(rawUrl);
  let redirects = 0;

  for (;;) {
    await assertHostAllowed(url, { lookupImpl });

    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new SafeFetchError('TIMEOUT', 'The page took too long to respond.');

    let res: Response;
    try {
      res = await fetchImpl(url.toString(), {
        redirect: 'manual',
        signal: AbortSignal.timeout(remaining),
        headers: { accept: 'text/html, text/plain', 'user-agent': 'warmline/1.0' },
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'TimeoutError') {
        throw new SafeFetchError('TIMEOUT', 'The page took too long to respond.');
      }
      // Never surface the raw upstream error.
      throw new SafeFetchError('FETCH_FAILED', 'The page could not be fetched.');
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      res.body?.cancel().catch(() => {});
      if (!location) throw new SafeFetchError('FETCH_FAILED', 'The page could not be fetched.');
      redirects += 1;
      if (redirects > maxRedirects) {
        throw new SafeFetchError('TOO_MANY_REDIRECTS', 'The page redirected too many times.');
      }
      let next: URL;
      try {
        next = new URL(location, url);
      } catch {
        throw new SafeFetchError('FETCH_FAILED', 'The page could not be fetched.');
      }
      url = assertUrlShape(next);
      continue; // loop re-runs the DNS + range check on the new host
    }

    if (!res.ok) {
      res.body?.cancel().catch(() => {});
      throw new SafeFetchError('FETCH_FAILED', 'The page could not be fetched.');
    }

    const contentType = (res.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase();
    if (!contentType || !ALLOWED_CONTENT_TYPES.includes(contentType)) {
      res.body?.cancel().catch(() => {});
      throw new SafeFetchError('BAD_CONTENT_TYPE', 'Only HTML or plain-text pages can be fetched.');
    }

    // Stream with a hard cap — abort rather than buffer past maxBytes.
    if (!res.body) return '';
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    for (;;) {
      if (Date.now() > deadline) {
        await reader.cancel().catch(() => {});
        throw new SafeFetchError('TIMEOUT', 'The page took too long to respond.');
      }
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new SafeFetchError('TOO_LARGE', 'The page is too large to fetch.');
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
  }
}
