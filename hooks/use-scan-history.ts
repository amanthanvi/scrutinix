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
import { normalizeUrlInput } from "@/lib/domain/url";

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
        const key = historyUrlKey(entry.url);
        const db = await getDatabase();
        // One entry per URL: a new scan replaces older scans of the same
        // link instead of stacking beside them (batch re-scans included).
        const tx = db.transaction(STORE_NAME, "readwrite");
        let cursor = await tx.store.openCursor();
        while (cursor) {
          if (
            cursor.value.id !== entry.id &&
            historyUrlKey(cursor.value.url) === key
          ) {
            await cursor.delete();
          }
          cursor = await cursor.continue();
        }
        await tx.store.put(entry);
        await tx.done;
        startTransition(() => {
          setEntries((previous) =>
            sortEntries([
              entry,
              ...previous.filter(
                (item) =>
                  item.id !== entry.id && historyUrlKey(item.url) !== key,
              ),
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

/**
 * The identity history dedupes on: the normalized URL, so "example.com"
 * and "https://example.com/" are one link. Unparseable legacy values fall
 * back to their trimmed text.
 */
export function historyUrlKey(url: unknown): string {
  const raw = typeof url === "string" ? url.trim() : "";
  const normalized = normalizeUrlInput(raw);
  return normalized.ok ? normalized.value.normalizedUrl : raw;
}

/** Newest entry per URL key; older duplicates from before upserts hide. */
function latestPerUrl(entries: HistoryEntry[]) {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = historyUrlKey(entry.url);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

async function loadHistory() {
  const db = await getDatabase();
  const values = await db.getAllFromIndex(STORE_NAME, "by-saved-at");
  return latestPerUrl(
    sortEntries(
      await withDerivedDrivers(
        values.flatMap((value) => {
          const entry = sanitizeHistoryEntry(value);
          return entry ? [entry] : [];
        }),
      ),
    ),
  );
}

/**
 * Entries saved before `threatInfo.scoredSignals` existed have no driver
 * list, so Summary would pick rows by severity alone and could hide the
 * checks behind a Suspicious verdict. Derive the list with the verdict
 * engine, loaded only when such an entry exists so the scorer and the
 * public-suffix list stay out of the main bundle.
 */
async function withDerivedDrivers(
  entries: HistoryEntry[],
): Promise<HistoryEntry[]> {
  const needsDrivers = entries.some(
    (entry) => entry.threatInfo && entry.threatInfo.scoredSignals === undefined,
  );
  if (!needsDrivers) {
    return entries;
  }

  try {
    const { withScoredSignals } = await import("@/lib/domain/verdict");
    return entries.map((entry) => withScoredSignals(entry));
  } catch (error) {
    console.warn("[Scrutinix] Could not derive verdict drivers.", error);
    return entries;
  }
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
