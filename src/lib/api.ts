import type { ApiError } from "@shared/types";

export class RequestError extends Error {
  constructor(
    public status: number,
    public body: ApiError,
  ) {
    super(body.error);
  }
}

const TOKEN = (window as unknown as { slate?: { token?: string } }).slate?.token;

async function request<T>(method: string, url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const headers: Record<string, string> = { "x-slate-client": "1" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (TOKEN) headers.authorization = `Bearer ${TOKEN}`;
  const response = await fetch(apiBase + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({ error: response.statusText }))) as ApiError;
    throw new RequestError(response.status, payload);
  }
  return response.json() as Promise<T>;
}

const apiBase = (window as unknown as { slate?: { apiBase?: string } }).slate?.apiBase ?? "";

export const api = {
  get: <T>(url: string, signal?: AbortSignal) => request<T>("GET", url, undefined, signal),
  post: <T>(url: string, body?: unknown, signal?: AbortSignal) => request<T>("POST", url, body ?? {}, signal),
  put: <T>(url: string, body?: unknown) => request<T>("PUT", url, body ?? {}),
  del: <T>(url: string) => request<T>("DELETE", url),
  async blob(url: string, body: unknown): Promise<Blob> {
    const headers: Record<string, string> = { "x-slate-client": "1", "content-type": "application/json" };
    if (TOKEN) headers.authorization = `Bearer ${TOKEN}`;
    const response = await fetch(apiBase + url, { method: "POST", headers, body: JSON.stringify(body) });
    if (!response.ok) throw new RequestError(response.status, await response.json().catch(() => ({ error: response.statusText })));
    return response.blob();
  },
};

export function errorMessage(error: unknown): string {
  if (error instanceof RequestError) return error.body.error;
  if (error instanceof Error) return error.message;
  return String(error);
}
