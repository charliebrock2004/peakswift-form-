/** Browser helpers shared by both forms: JSON posts and uploads with progress. */

export type Reply<T> = { ok: boolean; status: number; body: T & { error?: string } };

function parseReply<T>(status: number, text: string): Reply<T> {
  try {
    return { ok: status >= 200 && status < 300, status, body: JSON.parse(text) as T & { error?: string } };
  } catch {
    return {
      ok: false,
      status,
      body: { error: `The server didn’t respond properly (HTTP ${status || "no connection"}). Please try again in a moment.` } as T & { error?: string },
    };
  }
}

export async function postJson<T>(url: string, payload: unknown): Promise<Reply<T>> {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  return parseReply<T>(response.status, await response.text());
}

/** XHR rather than fetch so we can show real upload progress on slow mobile connections. */
export function postForm<T>(url: string, body: FormData, onProgress: (loaded: number, total: number) => void): Promise<Reply<T>> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded, event.total);
    };
    xhr.onload = () => resolve(parseReply<T>(xhr.status, xhr.responseText));
    xhr.onerror = () =>
      resolve({ ok: false, status: 0, body: { error: "The connection dropped while uploading. Check your signal and try again." } as T & { error?: string } });
    xhr.send(body);
  });
}
