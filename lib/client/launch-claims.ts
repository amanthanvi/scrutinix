import {
  SHARE_LAUNCH_WINDOW_MS,
  type LaunchGrant,
} from "@/lib/domain/share-launch";

/**
 * The share-target launches this browser has already scanned, by the
 * grant's random id (`lib/server/share-launch-grant.ts`), never the link.
 * The server keeps nothing: `proxy.ts` clears the launch cookie in the
 * first response for `/`, so only the browser can tell that a launch it
 * was rendered with already ran. Two ways it is rendered with one again:
 * going Back, where Next's router restores the page's render, launch and
 * all, into a new component; and a second tab that asked for the page
 * before the first answer cleared the cookie (its response may arrive, or
 * its page hydrate, much later).
 *
 * Two rules make each grant scan at most once:
 * - A grant launches only within `SHARE_LAUNCH_WINDOW_MS` of its issue
 *   (`launchAge`), so a page that holds it later only prefills.
 * - An id is kept until no page can launch it any more: until a page
 *   rendered more than `KEEP_MS` after the grant's issue (both on the
 *   server's clock) opens. Nothing unexpired is ever evicted to make room;
 *   a store already holding `MAX_KEPT` refuses the launch instead.
 * The check and the record are one IndexedDB `readwrite` transaction, and
 * those never overlap, in this tab or any other (IndexedDB §2.7.2), so two
 * tabs holding the same grant can't both find it unrecorded.
 */

const DATABASE_NAME = "scrutinix-launches";
const STORE_NAME = "launches";
/**
 * Ten times the launch window: the server instance that issued a grant and
 * the one that renders a later page would have to disagree by minutes
 * before an id is dropped while some page could still launch it.
 */
const KEEP_MS = 10 * 60 * 1000;
/** Launches come one at a time; 32 within ten minutes is not a person. */
const MAX_KEPT = 32;

/**
 * This page's own record, for as long as the page lives: a Back long after
 * the launch restores the same render, and still only prefills.
 */
const claimed = new Set<string>();

/**
 * How long ago, at most, the grant was issued: the server's own time from
 * issue to this page's render, plus the time since this document's
 * navigation began, which was before the render. Neither part compares
 * this device's clock with the server's, so a wrong clock here can't
 * shorten it. The time since navigation is the larger of the monotonic
 * `performance.now()` and the wall clock's (which also counts time the
 * device slept), so a clock set forward only makes it longer.
 */
export function launchAge(grant: LaunchGrant, renderedAt: number): number {
  const sinceNavigation = Math.max(
    performance.now(),
    Date.now() - performance.timeOrigin,
  );
  return Math.max(0, renderedAt - grant.issuedAt) + sinceNavigation;
}

function isLaunchable(grant: LaunchGrant, renderedAt: number): boolean {
  return launchAge(grant, renderedAt) <= SHARE_LAUNCH_WINDOW_MS;
}

/** A stored issue time no page rendered at `renderedAt` or later can launch. */
function isSpent(issuedAt: unknown, renderedAt: number): boolean {
  return typeof issuedAt !== "number" || renderedAt - issuedAt > KEEP_MS;
}

/**
 * The launch store, created when `create`, else null when this browser
 * has never kept one (so opening the page doesn't make one).
 */
function openStore(create: boolean): Promise<IDBDatabase | null> {
  return new Promise((resolve, reject) => {
    let absent = false;
    const request = window.indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (create) {
        request.result.createObjectStore(STORE_NAME);
      } else {
        absent = true;
        request.transaction!.abort();
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = (event) => {
      if (absent) {
        event.preventDefault();
        resolve(null);
      } else {
        reject(request.error ?? new Error("Couldn't open the launch store."));
      }
    };
  });
}

/**
 * In one `readwrite` transaction: drop every spent id, then call `finish`
 * with the ids kept while the transaction still holds the store. Resolves
 * with `finish`'s answer once the transaction commits.
 */
function sweep<T>(
  database: IDBDatabase,
  renderedAt: number,
  finish: (kept: Set<IDBValidKey>, store: IDBObjectStore) => T,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const kept = new Set<IDBValidKey>();
    let answer: T;
    const cursor = store.openCursor();
    cursor.onsuccess = () => {
      const entry = cursor.result;
      if (!entry) {
        answer = finish(kept, store);
        return;
      }
      if (isSpent(entry.value, renderedAt)) entry.delete();
      else kept.add(entry.key);
      entry.continue();
    };
    transaction.oncomplete = () => resolve(answer);
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("Launch store aborted."));
  });
}

/**
 * Whether this page should start the launch's scan: true once, for the
 * first page in this browser to claim the id within the grant's window,
 * and only once the claim is stored. False for any later claim (in any
 * tab), a grant past its window, a full store, or no IndexedDB: those
 * prefill and wait for a tap. `renderedAt` is the server's time when it
 * rendered this page.
 */
export async function claimLaunch(
  grant: LaunchGrant,
  renderedAt: number,
): Promise<boolean> {
  if (claimed.has(grant.id)) return false;
  claimed.add(grant.id);
  if (!isLaunchable(grant, renderedAt)) return false;
  try {
    const database = (await openStore(true))!;
    try {
      return await sweep(database, renderedAt, (kept, store) => {
        // Decided while this transaction holds the store: no other tab's
        // claim can come between this check and the record.
        if (kept.has(grant.id) || kept.size >= MAX_KEPT) return false;
        if (!isLaunchable(grant, renderedAt)) return false;
        store.put(grant.issuedAt, grant.id);
        return true;
      });
    } finally {
      database.close();
    }
  } catch {
    // Nowhere to record it: other tabs couldn't tell it ran.
    return false;
  }
}

/**
 * Drop ids no page can launch any more; the home page does this as it
 * opens, with the server's time when it rendered.
 */
export async function forgetSpentLaunches(renderedAt: number): Promise<void> {
  try {
    const database = await openStore(false);
    if (!database) return;
    try {
      await sweep(database, renderedAt, () => undefined);
    } finally {
      database.close();
    }
  } catch {
    // Nothing kept to forget.
  }
}
