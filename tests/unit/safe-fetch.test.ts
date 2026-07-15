import { describe, it, expect } from 'vitest';
import { safeFetchText, isBlockedAddress, SafeFetchError } from '@/lib/net/safe-fetch';

const publicLookup = async (_h: string) => [{ address: '93.184.216.34' }];

function textResponse(
  body: string,
  { status = 200, contentType = 'text/html', headers = {} as Record<string, string> } = {},
) {
  return new Response(body, {
    status,
    headers: { 'content-type': contentType, ...headers },
  });
}

async function expectCode(promise: Promise<unknown>, code: string) {
  try {
    await promise;
    expect.unreachable(`expected SafeFetchError ${code}`);
  } catch (err) {
    expect(err).toBeInstanceOf(SafeFetchError);
    expect((err as SafeFetchError).code).toBe(code);
  }
}

describe('isBlockedAddress', () => {
  const blocked = [
    '0.0.0.0',
    '0.1.2.3',
    '127.0.0.1',
    '127.255.255.254',
    '10.0.0.1',
    '10.255.255.255',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254', // cloud metadata
    '100.64.0.1', // CGNAT
    '224.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    '0:0:0:0:0:0:0:1',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    'febf::1',
    'ff02::1',
    '::ffff:10.0.0.1',
    '::ffff:0a00:0001', // hex-encoded mapped 10.0.0.1
    '::ffff:192.168.0.1',
  ];
  it.each(blocked)('blocks %s', (ip) => {
    expect(isBlockedAddress(ip)).toBe(true);
  });

  const allowed = [
    '93.184.216.34',
    '8.8.8.8',
    '172.15.0.1',
    '172.32.0.1',
    '2606:4700::6810:84e5',
    '::ffff:8.8.8.8',
  ];
  it.each(allowed)('allows %s', (ip) => {
    expect(isBlockedAddress(ip)).toBe(false);
  });
});

describe('safeFetchText URL shape', () => {
  it('rejects http URLs', async () => {
    await expectCode(safeFetchText('http://example.com'), 'BLOCKED_URL');
  });

  it('rejects non-URL junk and other protocols', async () => {
    await expectCode(safeFetchText('not a url'), 'BLOCKED_URL');
    await expectCode(safeFetchText('file:///etc/passwd'), 'BLOCKED_URL');
    await expectCode(safeFetchText('ftp://example.com/x'), 'BLOCKED_URL');
  });

  it('rejects embedded credentials', async () => {
    await expectCode(safeFetchText('https://user:pass@example.com'), 'BLOCKED_URL');
  });
});

describe('safeFetchText DNS guard', () => {
  it.each(['127.0.0.1', '10.1.2.3', '172.16.9.9', '192.168.0.10', '169.254.169.254'])(
    'rejects hostname resolving to %s',
    async (address) => {
      await expectCode(
        safeFetchText('https://evil.example.com', {
          lookupImpl: async () => [{ address }],
          fetchImpl: async () => textResponse('nope'),
        }),
        'BLOCKED_IP',
      );
    },
  );

  it('rejects when ANY resolved address is private (dns pinning trick)', async () => {
    await expectCode(
      safeFetchText('https://evil.example.com', {
        lookupImpl: async () => [{ address: '93.184.216.34' }, { address: '10.0.0.1' }],
        fetchImpl: async () => textResponse('nope'),
      }),
      'BLOCKED_IP',
    );
  });

  it('rejects private IP literals without consulting DNS', async () => {
    await expectCode(
      safeFetchText('https://192.168.1.1/admin', {
        lookupImpl: async () => {
          throw new Error('must not be called');
        },
        fetchImpl: async () => textResponse('nope'),
      }),
      'BLOCKED_IP',
    );
  });

  it('rejects ipv6 literal loopback', async () => {
    await expectCode(
      safeFetchText('https://[::1]/x', {
        lookupImpl: publicLookup,
        fetchImpl: async () => textResponse('nope'),
      }),
      'BLOCKED_IP',
    );
  });
});

describe('safeFetchText redirects', () => {
  it('re-checks the host after every redirect', async () => {
    const lookups: string[] = [];
    await expectCode(
      safeFetchText('https://ok.example.com', {
        lookupImpl: async (host) => {
          lookups.push(host);
          return host === 'ok.example.com'
            ? [{ address: '93.184.216.34' }]
            : [{ address: '169.254.169.254' }];
        },
        fetchImpl: async (input) =>
          String(input).includes('ok.example.com')
            ? textResponse('', {
                status: 302,
                headers: { location: 'https://internal.example.com/meta' },
              })
            : textResponse('secret'),
      }),
      'BLOCKED_IP',
    );
    expect(lookups).toEqual(['ok.example.com', 'internal.example.com']);
  });

  it('rejects redirect to non-https', async () => {
    await expectCode(
      safeFetchText('https://ok.example.com', {
        lookupImpl: publicLookup,
        fetchImpl: async () =>
          textResponse('', { status: 301, headers: { location: 'http://example.com/x' } }),
      }),
      'BLOCKED_URL',
    );
  });

  it('gives up after max redirects', async () => {
    let n = 0;
    await expectCode(
      safeFetchText('https://loop.example.com', {
        lookupImpl: publicLookup,
        fetchImpl: async () => {
          n += 1;
          return textResponse('', {
            status: 302,
            headers: { location: `https://loop.example.com/${n}` },
          });
        },
      }),
      'TOO_MANY_REDIRECTS',
    );
    expect(n).toBe(4); // initial + 3 redirects allowed, 4th redirect response rejected
  });
});

describe('safeFetchText response handling', () => {
  it('returns text for an allowed page', async () => {
    const text = await safeFetchText('https://jobs.example.com/posting', {
      lookupImpl: publicLookup,
      fetchImpl: async () => textResponse('<h1>Backend Engineer</h1>'),
    });
    expect(text).toContain('Backend Engineer');
  });

  it('rejects disallowed content types', async () => {
    await expectCode(
      safeFetchText('https://api.example.com/data', {
        lookupImpl: publicLookup,
        fetchImpl: async () => textResponse('{}', { contentType: 'application/json' }),
      }),
      'BAD_CONTENT_TYPE',
    );
  });

  it('rejects missing content type', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([120]));
        controller.close();
      },
    });
    await expectCode(
      safeFetchText('https://api.example.com/data', {
        lookupImpl: publicLookup,
        fetchImpl: async () => new Response(stream, { status: 200 }),
      }),
      'BAD_CONTENT_TYPE',
    );
  });

  it('aborts bodies over the size cap while streaming', async () => {
    const chunk = new Uint8Array(1024).fill(65);
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    });
    await expectCode(
      safeFetchText('https://big.example.com', {
        lookupImpl: publicLookup,
        maxBytes: 8 * 1024,
        fetchImpl: async () =>
          new Response(stream, { status: 200, headers: { 'content-type': 'text/plain' } }),
      }),
      'TOO_LARGE',
    );
    expect(cancelled).toBe(true);
  });

  it('times out slow responses', async () => {
    await expectCode(
      safeFetchText('https://slow.example.com', {
        lookupImpl: publicLookup,
        timeoutMs: 50,
        fetchImpl: (_input, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              const err = new Error('aborted');
              err.name = 'TimeoutError';
              reject(err);
            });
          }),
      }),
      'TIMEOUT',
    );
  });

  it('never surfaces raw upstream error details', async () => {
    try {
      await safeFetchText('https://broken.example.com', {
        lookupImpl: publicLookup,
        fetchImpl: async () => {
          throw new Error('ECONNRESET at 10.32.4.1:8443 pool-internal');
        },
      });
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).not.toContain('10.32.4.1');
      expect((err as Error).message).not.toContain('ECONNRESET');
      expect((err as SafeFetchError).code).toBe('FETCH_FAILED');
    }
  });

  it('rejects non-2xx statuses', async () => {
    await expectCode(
      safeFetchText('https://gone.example.com', {
        lookupImpl: publicLookup,
        fetchImpl: async () => textResponse('gone', { status: 404 }),
      }),
      'FETCH_FAILED',
    );
  });
});
