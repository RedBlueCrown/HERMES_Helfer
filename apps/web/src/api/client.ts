// Thin fetch wrapper: adds sign-in headers and a correlation ID, and turns
// API errors into ApiError with the German message from the server.

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly correlationId?: string,
  ) {
    super(message);
  }
}

export type HeaderSource = () => Promise<Record<string, string>>;

export interface Api {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  put<T>(path: string, body?: unknown): Promise<T>;
  del<T>(path: string): Promise<T>;
}

export function createApi(headers: HeaderSource): Api {
  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const h: Record<string, string> = { ...(await headers()), "x-correlation-id": crypto.randomUUID() };
    if (body !== undefined) h["content-type"] = "application/json";
    let res: Response;
    try {
      res = await fetch(path, {
        method,
        headers: h,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new ApiError(0, "offline", "Der Server ist nicht erreichbar. Bitte die Verbindung prüfen.");
    }
    if (!res.ok) {
      let payload: { error?: { code?: string; message?: string; correlationId?: string } } | undefined;
      try {
        payload = await res.json();
      } catch {
        payload = undefined;
      }
      throw new ApiError(
        res.status,
        payload?.error?.code ?? "error",
        payload?.error?.message ?? `Fehler ${res.status}`,
        payload?.error?.correlationId ?? res.headers.get("x-correlation-id") ?? undefined,
      );
    }
    return (await res.json()) as T;
  }
  return {
    get: (p) => request("GET", p),
    post: (p, b) => request("POST", p, b ?? {}),
    put: (p, b) => request("PUT", p, b ?? {}),
    del: (p) => request("DELETE", p),
  };
}
