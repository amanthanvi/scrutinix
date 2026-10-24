/**
 * The share-target launches this browser has already scanned, by the
 * grant's random id (`lib/server/share-launch-grant.ts`), never the link.
 * The server keeps nothing: `proxy.ts` clears the launch cookie in the
 * first response for `/`, so only the browser can tell that a launch it
 * was rendered with already ran. Two ways it is rendered with one again:
 * going Back, where Next's router restores the page's render, launch and
 * all, into a new component; and a second tab that asked for the page
 * before the first answer cleared the cookie.
 */

/** Read by every tab of this origin, unlike `sessionStorage`. */
const STORAGE_KEY = "sx-launches";
/**
 * How long an id is kept. A grant reaches the page within a minute of the
 * share (`SHARE_LAUNCH_MAX_AGE_SECONDS`); another tab holding it is
 * seconds behind.
 */
const KEEP_MS = 10 * 60 * 1000;
/** Launches come one at a time; a handful of ids is plenty. */
const MAX_ENTRIES = 8;

type Entry = [id: string, at: number];

/**
 * This page's own record, which holds wherever storage is refused
 * (private modes) and for as long as the page lives: a Back long after
 * `KEEP_MS` restores the same render, and still only prefills.
 */
const claimed = new Set<string>();

/** The ids kept in storage, untrusted as stored, recent ones only. */
function recentEntries(storage: Storage, now: number): Entry[] {
  let stored: unknown;
  try {
    stored = JSON.parse(storage.getItem(STORAGE_KEY) ?? "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(stored)) return [];
  return stored
    .filter(
      (entry): entry is Entry =>
        Array.isArray(entry) &&
        typeof entry[0] === "string" &&
        typeof entry[1] === "number" &&
        Math.abs(now - entry[1]) < KEEP_MS,
    )
    .slice(-MAX_ENTRIES);
}

function store(storage: Storage, entries: Entry[]) {
  if (entries.length) {
    storage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
  } else {
    storage.removeItem(STORAGE_KEY);
  }
}

/**
 * Whether this page should start the launch's scan: true the first time
 * this browser sees the id, then false (in any tab, where storage allows).
 * Recording it is the claim.
 */
export function claimLaunch(id: string, now = Date.now()): boolean {
  if (claimed.has(id)) return false;
  claimed.add(id);
  try {
    const storage = window.localStorage;
    const entries = recentEntries(storage, now);
    if (entries.some(([seen]) => seen === id)) return false;
    store(storage, [...entries, [id, now]]);
  } catch {
    // Storage refused: the page's own record still holds.
  }
  return true;
}

/** Drop ids older than `KEEP_MS`; the home page does this as it opens. */
export function forgetOldLaunches(now = Date.now()): void {
  try {
    const storage = window.localStorage;
    if (storage.getItem(STORAGE_KEY) === null) return;
    store(storage, recentEntries(storage, now));
  } catch {
    // Nothing kept to forget.
  }
}
