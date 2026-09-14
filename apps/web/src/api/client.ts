import type { ApiError } from '@apion/contracts';

const API_BASE = '/api/v1';

const TOKEN_KEY = 'apion.token';

/**
 * The session token lives in localStorage rather than a cookie because the SPA
 * and API are same-origin here and the token is read by the WebSocket handshake
 * in Phase 4. If the deployment ever splits origins this moves to an httpOnly
 * cookie, which is why every read goes through these two functions.
 */
export function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function writeToken(token: string | null): void {
  try {
    if (token === null) localStorage.removeItem(TOKEN_KEY);
    else localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // A browser with storage disabled still works for one session.
  }
}

/**
 * A failed request, carrying enough for the UI to say something specific.
 * `VERSION_CONFLICT` additionally carries the server's current state so the
 * conflict UI can show both sides without a second fetch (PRD 01).
 */
export class RequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: { pointer: string; message: string }[],
    readonly conflict?: {
      expectedVersion: number;
      actualVersion: number;
      current: unknown;
    },
  ) {
    super(message);
    this.name = 'RequestError';
  }

  get isConflict(): boolean {
    return this.code === 'VERSION_CONFLICT';
  }

  get isUnauthenticated(): boolean {
    return this.code === 'UNAUTHENTICATED';
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Sent as `If-Match` for an optimistic-concurrency write. */
  entityVersion?: number;
  signal?: AbortSignal;
  /** Set for endpoints that answer with text rather than JSON. */
  accept?: 'json' | 'text';
}

export async function request<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const token = readToken();
  const headers: Record<string, string> = {
    accept: options.accept === 'text' ? 'text/plain' : 'application/json',
  };

  if (token) headers['authorization'] = `Bearer ${token}`;
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.entityVersion !== undefined) {
    headers['if-match'] = `"${options.entityVersion}"`;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method ?? 'GET',
    headers,
    signal: options.signal,
    ...(options.body === undefined
      ? {}
      : { body: JSON.stringify(options.body) }),
  });

  if (response.status === 204) return undefined as T;

  const text = await response.text();

  if (options.accept === 'text') {
    if (!response.ok)
      throw new RequestError(response.status, 'INTERNAL_ERROR', text);
    return text as T;
  }

  const parsed: unknown = text.length > 0 ? JSON.parse(text) : undefined;

  if (!response.ok) throw toRequestError(response.status, parsed);

  return parsed as T;
}

function toRequestError(status: number, body: unknown): RequestError {
  const error = (body as ApiError | undefined)?.error;

  if (!error) {
    return new RequestError(
      status,
      'INTERNAL_ERROR',
      'The server did not explain what went wrong.',
    );
  }

  const conflict = body as {
    error: {
      expectedVersion?: number;
      actualVersion?: number;
      current?: unknown;
    };
  };

  return new RequestError(
    status,
    error.code,
    error.message,
    error.details,
    conflict.error.expectedVersion !== undefined
      ? {
          expectedVersion: conflict.error.expectedVersion,
          actualVersion: conflict.error.actualVersion as number,
          current: conflict.error.current,
        }
      : undefined,
  );
}
