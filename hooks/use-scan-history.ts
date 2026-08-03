"use client";

import { deleteDB, openDB, type DBSchema, type IDBPDatabase } from "idb";
import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import { sanitizeHistoryEntry } from "@/lib/domain/runtime-safety";
import type { AnalysisResult, HistoryEntry } from "@/lib/domain/types";

interface HistoryDatabase extends DBSchema {
  scans: {
    key: string;
    value: HistoryEntry;
    indexes: {
      "by-saved-at": string;
    };
  };
}

const DATABASE_NAME = "scrutinix-v2";
const LEGACY_DATABASE_NAME = "malicious-url-detector-v2";
const STORE_NAME = "scans";

let dbPromise: Promise<IDBPDatabase<HistoryDatabase>> | null = null;

export async function resetHistoryDatabaseForTests() {
  const pending = dbPromise;
  dbPromise = null;
  if (pending) {
    try {
      (await pending).close();
    } catch {
      // Connection never opened; nothing to close.
    }
  }
}

export function useScanHistory() {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [historyQuery, setHistoryQuery] = useState("");
  const [lastClearedEntries, setLastClearedEntries] = useState<HistoryEntry[]>(
    [],
  );
  const [historyUnavailable, setHistoryUnavailable] = useState(false);
  const failureNotified = useRef(false);

  // IndexedDB can be blocked (private browsing, storage pressure). Every
  // failure lands here instead of an unhandled rejection: the user gets one
  // toast, and historyUnavailable exposes the state to the UI.
  const reportHistoryFailure = useCallback((action: string, error: unknown) => {
    console.warn(`[Scrutinix] Scan history ${action} failed.`, error);
    setHistoryUnavailable(true);
    if (!failureNotified.current) {
      failureNotified.current = true;
      toast.error("Scan history is unavailable in this browser session.");
    }
  }, []);

  useEffect(() => {
    loadHistory()
      .then((loaded) => {
        setEntries(loaded);
        setHistoryUnavailable(false);
      })
      .catch((error: unknown) => {
        reportHistoryFailure("loading", error);
      });
  }, [reportHistoryFailure]);

  const addResult = useCallback(
    async (result: AnalysisResult) => {
      try {
        const entry: HistoryEntry = {
          ...result,
          savedAt: new Date().toISOString(),
        };
        const db = await getDatabase();
        await db.put(STORE_NAME, entry);
        startTransition(() => {
          setEntries((previous) =>
            sortEntries([
              entry,
              ...previous.filter((item) => item.id !== entry.id),
            ]),
          );
          setLastClearedEntries([]);
        });
      } catch (error) {
        reportHistoryFailure("saving", error);
      }
    },
    [reportHistoryFailure],
  );

  const clearHistory = useCallback(async () => {
    try {
      const snapshot = entries;
      const db = await getDatabase();
      await db.clear(STORE_NAME);
      startTransition(() => {
        setEntries([]);
        setLastClearedEntries(snapshot);
      });
    } catch (error) {
      reportHistoryFailure("clearing", error);
    }
  }, [entries, reportHistoryFailure]);

  const undoClearHistory = useCallback(async () => {
    if (!lastClearedEntries.length) {
      return;
    }

    try {
      const db = await getDatabase();
      const tx = db.transaction(STORE_NAME, "readwrite");
      await Promise.all(lastClearedEntries.map((entry) => tx.store.put(entry)));
      await tx.done;

      startTransition(() => {
        setEntries(sortEntries(lastClearedEntries));
        setLastClearedEntries([]);
      });
    } catch (error) {
      reportHistoryFailure("restoring", error);
    }
  }, [lastClearedEntries, reportHistoryFailure]);

  const filteredEntries = useMemo(() => {
    const query = historyQuery.trim().toLowerCase();
    if (query.length === 0) return entries;
    return entries.filter((entry) => {
      const url = typeof entry.url === "string" ? entry.url : "";
      const summary =
        typeof entry.threatInfo?.summary === "string"
          ? entry.threatInfo.summary
          : "";
      const verdict = typeof entry.verdict === "string" ? entry.verdict : "";
      return (
        url.toLowerCase().includes(query) ||
        verdict.toLowerCase().includes(query) ||
        summary.toLowerCase().includes(query)
      );
    });
  }, [entries, historyQuery]);

  return {
    entries,
    filteredEntries,
    historyQuery,
    setHistoryQuery,
    addResult,
    clearHistory,
    undoClearHistory,
    canUndoClear: lastClearedEntries.length > 0,
    historyUnavailable,
  };
}

async function loadHistory() {
  const db = await getDatabase();
  const values = await db.getAllFromIndex(STORE_NAME, "by-saved-at");
  return sortEntries(
    values.flatMap((value) => {
      const entry = sanitizeHistoryEntry(value);
      return entry ? [entry] : [];
    }),
  );
}

function sortEntries(entries: HistoryEntry[]) {
  return [...entries].sort((left, right) => {
    const leftSavedAt = typeof left.savedAt === "string" ? left.savedAt : "";
    const rightSavedAt = typeof right.savedAt === "string" ? right.savedAt : "";
    return rightSavedAt.localeCompare(leftSavedAt);
  });
}

function getDatabase() {
  if (typeof window === "undefined") {
    return Promise.reject(
      new Error("IndexedDB is only available in the browser."),
    );
  }

  if (!dbPromise) {
    dbPromise = openHistoryDatabase();
  }

  return dbPromise;
}

async function openHistoryDatabase() {
  const database = await openDB<HistoryDatabase>(DATABASE_NAME, 1, {
    upgrade(upgradeDatabase) {
      initializeHistoryStore(upgradeDatabase);
    },
  });

  try {
    await migrateLegacyHistory(database);
  } catch (error) {
    console.warn("[Scrutinix] Failed to migrate legacy scan history.", error);
  }
  return database;
}

function initializeHistoryStore(database: IDBPDatabase<HistoryDatabase>) {
  if (database.objectStoreNames.contains(STORE_NAME)) {
    return;
  }

  const store = database.createObjectStore(STORE_NAME, { keyPath: "id" });
  store.createIndex("by-saved-at", "savedAt");
}

async function migrateLegacyHistory(database: IDBPDatabase<HistoryDatabase>) {
  const legacyEntries = await readLegacyHistoryEntries();
  if (legacyEntries.length === 0) {
    return;
  }

  const transaction = database.transaction(STORE_NAME, "readwrite");
  await Promise.all(legacyEntries.map((entry) => transaction.store.put(entry)));
  await transaction.done;

  await deleteDB(LEGACY_DATABASE_NAME);
}

async function readLegacyHistoryEntries() {
  const legacyDatabase = await openLegacyDatabase();
  if (!legacyDatabase) {
    return [];
  }

  if (legacyDatabase.wasCreated) {
    legacyDatabase.database.close();
    await deleteDB(LEGACY_DATABASE_NAME);
    return [];
  }

  if (!legacyDatabase.database.objectStoreNames.contains(STORE_NAME)) {
    legacyDatabase.database.close();
    return [];
  }

  const transaction = legacyDatabase.database.transaction(
    STORE_NAME,
    "readonly",
  );
  const store = transaction.objectStore(STORE_NAME);
  const entries = await requestToPromise<unknown[]>(store.getAll());
  legacyDatabase.database.close();
  return entries.flatMap((value) => {
    const entry = sanitizeHistoryEntry(value);
    return entry ? [entry] : [];
  });
}

async function openLegacyDatabase() {
  return await new Promise<{
    database: IDBDatabase;
    wasCreated: boolean;
  } | null>((resolve, reject) => {
    const request = window.indexedDB.open(LEGACY_DATABASE_NAME);
    let wasCreated = false;

    request.onupgradeneeded = () => {
      wasCreated = true;
    };
    request.onsuccess = () => {
      resolve({
        database: request.result,
        wasCreated,
      });
    };
    request.onerror = () => {
      reject(
        request.error ??
          new Error("Failed to open the legacy history database."),
      );
    };
    request.onblocked = () => {
      reject(new Error("Legacy history migration was blocked by another tab."));
    };
  });
}

async function requestToPromise<T>(request: IDBRequest<T>) {
  return await new Promise<T>((resolve, reject) => {
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error ?? new Error("IndexedDB request failed."));
    };
  });
}
