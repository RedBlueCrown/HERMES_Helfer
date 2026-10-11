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

/** `signal` stops the request; a request to an agent then stops the model call on the server too. */
export interface RequestOptions {
  signal?: AbortSignal | undefined;
}

/** A file from the API, with the name the server gave it. */
export interface Download {
  blob: Blob;
  fileName: string;
}

export interface Api {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown, opts?: RequestOptions): Promise<T>;
  put<T>(path: string, body?: unknown): Promise<T>;
  del<T>(path: string): Promise<T>;
  /** Sends a file as it is (not as JSON), with its name in a header. */
  upload<T>(path: string, file: File): Promise<T>;
  download(path: string): Promise<Download>;
}

/** The file name of a download: the UTF-8 form (RFC 6266) if there is one. */
function fileNameOf(res: Response, fallback: string): string {
  const header = res.headers.get("content-disposition") ?? "";
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(header)?.[1];
  if (utf8) {
    try {
      return decodeURIComponent(utf8);
    } catch {
      // fall through to the plain name
    }
  }
  return /filename="([^"]+)"/i.exec(header)?.[1] ?? fallback;
}

interface Body {
  data: BodyInit;
  type: string;
  headers?: Record<string, string>;
}

export function createApi(headers: HeaderSource): Api {
  async function send(
    method: string,
    path: string,
    body?: Body,
    opts: RequestOptions = {},
  ): Promise<Response> {
    const h: Record<string, string> = {
      ...(await headers()),
      "x-correlation-id": crypto.randomUUID(),
      ...body?.headers,
    };
    if (body) h["content-type"] = body.type;
    let res: Response;
    try {
      res = await fetch(path, {
        method,
        headers: h,
        ...(body ? { body: body.data } : {}),
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
    } catch {
      if (opts.signal?.aborted) throw new ApiError(0, "aborted", "Abgebrochen.");
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
    return res;
  }
  async function request<T>(
    method: string,
    path: string,
    body?: unknown,
    opts: RequestOptions = {},
  ): Promise<T> {
    const json = body === undefined ? undefined : { data: JSON.stringify(body), type: "application/json" };
    return (await (await send(method, path, json, opts)).json()) as T;
  }
  return {
    get: (p) => request("GET", p),
    post: (p, b, o) => request("POST", p, b ?? {}, o),
    put: (p, b) => request("PUT", p, b ?? {}),
    del: (p) => request("DELETE", p),
    upload: async <T>(p: string, file: File) => {
      const res = await send("PUT", p, {
        data: file,
        type: "application/octet-stream",
        headers: { "x-file-name": encodeURIComponent(file.name) },
      });
      return (await res.json()) as T;
    },
    download: async (p) => {
      const res = await send("GET", p);
      return { blob: await res.blob(), fileName: fileNameOf(res, "dokument.docx") };
    },
  };
}

/** Saves a downloaded file in the browser's download folder. */
export function saveFile({ blob, fileName }: Download): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  // The browser has the file once the click is handled.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
