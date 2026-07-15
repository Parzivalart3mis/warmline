import useSWR, { type SWRConfiguration } from 'swr';

/** Shared error shape from every route: { error: { code, message } }. */
export class ClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function parse(res: Response) {
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const err = data?.error ?? {};
    throw new ClientError(err.code ?? 'ERROR', err.message ?? 'Something failed.', res.status);
  }
  return data;
}

export const fetcher = (url: string) => fetch(url).then(parse);

export async function apiSend<T = unknown>(
  url: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  body?: unknown,
): Promise<T> {
  const res = await fetch(url, {
    method,
    ...(body !== undefined
      ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
      : {}),
  });
  return parse(res);
}

export function useApi<T>(key: string | null, config?: SWRConfiguration) {
  return useSWR<T>(key, fetcher, config);
}
