import type { FileKind } from "@/lib/onboarding/model";

/**
 * Keeps prepared (already compressed) uploads in IndexedDB on the client's
 * own device, so a refresh, a closed tab or an in-app browser reload does not
 * lose their photos. Nothing here leaves the browser until they submit.
 * Every call is best-effort: private mode or blocked storage just means files
 * are kept in memory only, as before.
 */

export type StoredFile = { key: string; kind: FileKind; name: string; type: string; blob: Blob; order: number };

const DB = "peakswift-brief-files";
const STORE = "files";

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const request = indexedDB.open(DB, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: "key" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | null> {
  const db = await open();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, mode);
      const request = work(tx.objectStore(STORE));
      tx.oncomplete = () => {
        db.close();
        resolve(request ? (request.result as T) : null);
      };
      tx.onerror = () => {
        db.close();
        resolve(null);
      };
      tx.onabort = () => {
        db.close();
        resolve(null);
      };
    } catch {
      db.close();
      resolve(null);
    }
  });
}

export async function loadDraftFiles(): Promise<StoredFile[]> {
  const rows = await run<StoredFile[]>("readonly", (store) => store.getAll() as IDBRequest<StoredFile[]>);
  return (rows ?? []).filter((row) => row && row.blob instanceof Blob).sort((a, b) => a.order - b.order);
}

export async function saveDraftFile(file: StoredFile): Promise<void> {
  await run("readwrite", (store) => store.put(file));
}

export async function deleteDraftFile(key: string): Promise<void> {
  await run("readwrite", (store) => store.delete(key));
}

export async function clearDraftFiles(): Promise<void> {
  await run("readwrite", (store) => store.clear());
}
