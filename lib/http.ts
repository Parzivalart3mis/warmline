import { NextResponse } from 'next/server';
import type { ZodType } from 'zod';

/** Shared error shape: { error: { code, message } } on every route. */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function jsonError(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function readJson<S extends ZodType>(req: Request, schema: S) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new ApiError('VALIDATION_ERROR', 'Request body must be JSON.', 400);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.join('.') ?? '';
    throw new ApiError(
      'VALIDATION_ERROR',
      `${path ? `${path}: ` : ''}${issue?.message ?? 'Invalid request.'}`,
      400,
    );
  }
  return parsed.data;
}

export function parseQuery<S extends ZodType>(url: string, schema: S) {
  const params = Object.fromEntries(new URL(url).searchParams.entries());
  const parsed = schema.safeParse(params);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ApiError('VALIDATION_ERROR', issue?.message ?? 'Invalid query.', 400);
  }
  return parsed.data;
}

type RouteContext = { params: Promise<Record<string, string>> };

function toResponse(err: unknown): Response {
  if (err instanceof ApiError) return jsonError(err.code, err.message, err.status);
  console.error('[route]', err instanceof Error ? `${err.name}: ${err.message}` : err);
  return jsonError('INTERNAL', 'Unexpected server error. Check the server logs.', 500);
}

/**
 * Wraps a handler with the shared error contract. Overloaded so no-param
 * routes export a single-argument handler (Next's route type validator
 * rejects a second argument typed `undefined`), while dynamic routes keep
 * their typed `{ params }` context.
 */
export function route(fn: (req: Request) => Promise<Response>): (req: Request) => Promise<Response>;
export function route<C extends RouteContext>(
  fn: (req: Request, ctx: C) => Promise<Response>,
): (req: Request, ctx: C) => Promise<Response>;
export function route(fn: (req: Request, ctx?: RouteContext) => Promise<Response>) {
  return async (req: Request, ctx?: RouteContext): Promise<Response> => {
    try {
      return await fn(req, ctx);
    } catch (err) {
      return toResponse(err);
    }
  };
}
