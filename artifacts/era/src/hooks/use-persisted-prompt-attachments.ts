import { useCallback, useEffect, useState } from "react";
import {
  getPromptAttachmentStorageKey as createStorageKey,
  validatePromptAttachmentSelection,
} from "@/lib/prompt-attachments";

const DATABASE_NAME = "era-prompt-attachments";
const DATABASE_VERSION = 1;
const STORE_NAME = "pending-files";

interface StoredFile {
  name: string;
  type: string;
  lastModified: number;
  blob: Blob;
}

interface StoredAttachmentSet {
  key: string;
  files: StoredFile[];
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("Browser file storage is unavailable."));
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open browser file storage."));
    request.onblocked = () => reject(new Error("Browser file storage is busy in another tab."));
  });
}

function loadFiles(key: string): Promise<File[]> {
  return openDatabase().then(database => new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).get(key) as IDBRequest<StoredAttachmentSet | undefined>;
    request.onsuccess = () => {
      const files = (request.result?.files ?? []).map(saved =>
        new File([saved.blob], saved.name, {
          type: saved.type,
          lastModified: saved.lastModified,
        }),
      );
      resolve(files);
    };
    request.onerror = () => reject(request.error ?? new Error("Could not restore attached files."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Could not restore attached files."));
  }));
}

function saveFiles(key: string, files: readonly File[]): Promise<void> {
  return openDatabase().then(database => new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    if (files.length === 0) {
      store.delete(key);
    } else {
      const record: StoredAttachmentSet = {
        key,
        files: files.map(file => ({
          name: file.name,
          type: file.type,
          lastModified: file.lastModified,
          blob: file.slice(0, file.size, file.type),
        })),
      };
      store.put(record);
    }
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Could not save attached files."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Could not save attached files."));
  }));
}

export function getPromptAttachmentStorageKey(
  userId: string | null | undefined,
  surface: string,
): string | null {
  return createStorageKey(userId, surface);
}

export async function clearPromptAttachmentStorage(key: string | null): Promise<void> {
  if (key) await saveFiles(key, []);
}

export function usePersistedPromptAttachments(
  userId: string | null | undefined,
  surface: string,
): {
  files: File[];
  setFiles: (files: File[]) => void;
  storageKey: string | null;
  isRestoring: boolean;
  persistenceError: boolean;
} {
  const storageKey = getPromptAttachmentStorageKey(userId, surface);
  const [files, setFilesState] = useState<File[]>([]);
  const [readyKey, setReadyKey] = useState<string | null>(null);
  const [persistenceError, setPersistenceError] = useState(false);

  useEffect(() => {
    let active = true;
    setFilesState([]);
    setReadyKey(storageKey);
    setPersistenceError(false);
    if (!storageKey) return () => { active = false; };

    setReadyKey(null);
    void loadFiles(storageKey).then(async restored => {
      if (!active) return;
      if (validatePromptAttachmentSelection(restored)) {
        setFilesState([]);
        setPersistenceError(true);
        await clearPromptAttachmentStorage(storageKey).catch(() => undefined);
      } else {
        setFilesState(restored);
      }
      setReadyKey(storageKey);
    }).catch(() => {
      if (!active) return;
      setPersistenceError(true);
      setReadyKey(storageKey);
    });

    return () => { active = false; };
  }, [storageKey]);

  const setFiles = useCallback((nextFiles: File[]) => {
    const validationError = validatePromptAttachmentSelection(nextFiles);
    if (validationError) return;
    setFilesState(nextFiles);
    if (!storageKey || readyKey !== storageKey) return;
    void saveFiles(storageKey, nextFiles).then(
      () => setPersistenceError(false),
      () => setPersistenceError(true),
    );
  }, [readyKey, storageKey]);

  return {
    files,
    setFiles,
    storageKey,
    isRestoring: !userId || Boolean(storageKey && readyKey !== storageKey),
    persistenceError,
  };
}
