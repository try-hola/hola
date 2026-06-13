// Centralized ErrorResponse handling for fetch calls in web
// Uses shared ErrorResponse shape from @hola/shared when available for type compatibility
import type { ErrorResponse as SharedErrorResponse } from '@hola/shared';

// Local alias to avoid tight coupling to nested shape during parsing
export type ErrorResponse = SharedErrorResponse;

// Attempt to extract a user-friendly error message from a non-OK Response
export async function toErrorMessage(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as Partial<ErrorResponse> | unknown;
    // Narrow safely without using any
    const message =
      typeof data === 'object' &&
      data !== null &&
      'error' in data &&
      typeof (data as { error?: unknown }).error === 'object' &&
      (data as { error: { message?: unknown } }).error !== null &&
      typeof (data as { error: { message?: unknown } }).error.message === 'string' &&
      (data as { error: { message: string } }).error.message.trim().length > 0
        ? (data as { error: { message: string } }).error.message
        : undefined;

    if (message) return message;
    return `Request failed with ${res.status} ${res.statusText}`;
  } catch {
    return `Request failed with ${res.status} ${res.statusText}`;
  }
}

// Ensure response is OK; otherwise throw an Error with a friendly message
export async function ensureOk(res: Response): Promise<Response> {
  if (!res.ok) {
    throw new Error(await toErrorMessage(res));
  }
  return res;
}

// Helper to wrap fetch with consistent network error handling and ensureOk
export async function safeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  try {
    const res = await fetch(input, init);
    return await ensureOk(res);
  } catch (err) {
    // Network errors (e.g., DNS, refused) surface here as thrown exceptions from fetch()
    if (err instanceof Error) {
      // Keep message concise and user-facing
      throw new Error(err.message || 'Network request failed', { cause: err });
    }
    throw new Error('Network request failed', { cause: err });
  }
}
