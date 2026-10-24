import "fake-indexeddb/auto";

import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LaunchGrant } from "@/lib/domain/share-launch";

/**
 * A page of its own: a fresh module, so a fresh in-page record, as another
 * tab or a later document has. What it shares with other pages is the
 * browser's IndexedDB.
 */
async function openPage() {
  vi.resetModules();
  return await import("@/lib/client/launch-claims");
}

/** The server's clock: grants are issued and pages rendered on it. */
const ISSUED = Date.parse("2026-10-24T12:00:00.000Z");
const SECOND = 1_000;
const MINUTE = 60 * SECOND;

function grant(id: string, issuedAt = ISSUED): LaunchGrant {
  return { id, issuedAt };
}

/** Shift this page's own clocks, as a slow or wrong device would. */
function shiftClock(target: "performance" | "date", by: number) {
  if (target === "performance") {
    const now = performance.now.bind(performance);
    vi.spyOn(performance, "now").mockImplementation(() => now() + by);
  } else {
    const now = Date.now.bind(Date);
    vi.spyOn(Date, "now").mockImplementation(() => now() + by);
  }
}

/** What the browser keeps: `[id, issuedAt]`, or null with no store at all. */
async function kept(): Promise<[IDBValidKey, unknown][] | null> {
  const names = (await indexedDB.databases()).map(({ name }) => name);
  if (!names.includes("scrutinix-launches")) return null;
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("scrutinix-launches");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const store = database.transaction("launches").objectStore("launches");
  const read = <T>(request: IDBRequest<T>) =>
    new Promise<T>(
      (resolve) => (request.onsuccess = () => resolve(request.result)),
    );
  const [keys, values] = await Promise.all([
    read(store.getAllKeys()),
    read(store.getAll()),
  ]);
  database.close();
  return keys.map((key, index) => [key, values[index]]);
}

beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("claimLaunch", () => {
  it("launches each grant once, in this page and in any other", async () => {
    const first = await openPage();
    expect(await first.claimLaunch(grant("one"), ISSUED + SECOND)).toBe(true);
    // A remount (going Back) in the same page.
    expect(await first.claimLaunch(grant("one"), ISSUED + SECOND)).toBe(false);
    // Another tab rendered with the same grant.
    const second = await openPage();
    expect(await second.claimLaunch(grant("one"), ISSUED + SECOND)).toBe(false);
    // A new share is a new grant.
    expect(await second.claimLaunch(grant("two"), ISSUED + SECOND)).toBe(true);
    // The random id and its issue time, never the link.
    expect(await kept()).toEqual([
      ["one", ISSUED],
      ["two", ISSUED],
    ]);
  });

  it("lets exactly one of several tabs claiming at once win", async () => {
    const tabs = [];
    for (let tab = 0; tab < 6; tab += 1) tabs.push(await openPage());
    const answers = await Promise.all(
      tabs.map((tab) => tab.claimLaunch(grant("raced"), ISSUED + SECOND)),
    );
    expect(answers.filter(Boolean)).toHaveLength(1);
  });

  it("never scans a held page's launch again, however many shares came since", async () => {
    // Round 3 repro A: nine shares gave ten scans once eight newer ids had
    // pushed the first out.
    const first = await openPage();
    let scans = 0;
    for (let share = 0; share < 10; share += 1) {
      const page = share === 0 ? first : await openPage();
      const at = ISSUED + share * 10 * SECOND;
      if (await page.claimLaunch(grant(`share-${share}`, at), at + SECOND)) {
        scans += 1;
      }
    }
    expect(scans).toBe(10);
    // The held second page, rendered with the first grant, hydrates now.
    const held = await openPage();
    expect(await held.claimLaunch(grant("share-0"), ISSUED + SECOND)).toBe(
      false,
    );
  });

  it("refuses rather than evicts when the store is full of ids still in use", async () => {
    const page = await openPage();
    for (let share = 0; share < 32; share += 1) {
      expect(
        await page.claimLaunch(grant(`full-${share}`), ISSUED + SECOND),
      ).toBe(true);
    }
    expect(await page.claimLaunch(grant("one-more"), ISSUED + SECOND)).toBe(
      false,
    );
    // Nothing was dropped to make room: the oldest still can't scan again.
    const later = await openPage();
    expect(await later.claimLaunch(grant("full-0"), ISSUED + SECOND)).toBe(
      false,
    );
    expect(await kept()).toHaveLength(32);

    // Once no page can launch them, the next page to open drops them.
    const afterwards = ISSUED + 10 * MINUTE + 1;
    await (await openPage()).forgetSpentLaunches(afterwards);
    expect(await kept()).toEqual([]);
    expect(
      await (
        await openPage()
      ).claimLaunch(grant("fresh", afterwards), afterwards + SECOND),
    ).toBe(true);
  });

  it("keeps an id until a page rendered over ten minutes after its share opens", async () => {
    const page = await openPage();
    expect(await page.claimLaunch(grant("kept"), ISSUED + SECOND)).toBe(true);
    for (const renderedAt of [ISSUED + 5 * MINUTE, ISSUED + 10 * MINUTE]) {
      await (await openPage()).forgetSpentLaunches(renderedAt);
      expect(await kept()).toEqual([["kept", ISSUED]]);
    }
    await (await openPage()).forgetSpentLaunches(ISSUED + 10 * MINUTE + 1);
    expect(await kept()).toEqual([]);
  });

  it("judges what to keep by the server's clock, never this device's", async () => {
    // Round 3 repro B: a page whose Date.now() ran eleven minutes ahead
    // dropped the first tab's record, and scanned again.
    expect(
      await (await openPage()).claimLaunch(grant("skew"), ISSUED + SECOND),
    ).toBe(true);
    shiftClock("date", 11 * MINUTE);
    const skewed = await openPage();
    await skewed.forgetSpentLaunches(ISSUED + 2 * SECOND);
    expect(await kept()).toEqual([["skew", ISSUED]]);
    expect(await skewed.claimLaunch(grant("skew"), ISSUED + 2 * SECOND)).toBe(
      false,
    );
  });

  it("drops nothing it can't read, and makes no store just by opening", async () => {
    await (await openPage()).forgetSpentLaunches(ISSUED);
    expect(await kept()).toBeNull();
  });

  it("fails closed with no IndexedDB: nowhere to tell other tabs it ran", async () => {
    vi.stubGlobal("indexedDB", undefined);
    const page = await openPage();
    expect(await page.claimLaunch(grant("nowhere"), ISSUED + SECOND)).toBe(
      false,
    );
  });
});

describe("a launch's window", () => {
  it("launches within a minute of the share, and only prefills after", async () => {
    // Each page fresh; the share-to-render part on the server's clock.
    expect(
      await (
        await openPage()
      ).claimLaunch(grant("on-time"), ISSUED + 50 * SECOND),
    ).toBe(true);
    expect(
      await (await openPage()).claimLaunch(grant("late"), ISSUED + 61 * SECOND),
    ).toBe(false);
    // A refused launch records nothing.
    expect((await kept())!.map(([id]) => id)).toEqual(["on-time"]);
  });

  it("counts the time from navigation to hydration on this page's own clock", async () => {
    // Rendered a second after the share, then held a minute on the way in.
    shiftClock("performance", 60 * SECOND);
    expect(
      await (await openPage()).claimLaunch(grant("held"), ISSUED + SECOND),
    ).toBe(false);
  });

  it("counts a wall clock run ahead (or a device that slept) as time passed", async () => {
    shiftClock("date", 11 * MINUTE);
    expect(
      await (await openPage()).claimLaunch(grant("ahead"), ISSUED + SECOND),
    ).toBe(false);
  });

  it("still launches with a wall clock set back: the monotonic clock counts", async () => {
    shiftClock("date", -60 * MINUTE);
    expect(
      await (await openPage()).claimLaunch(grant("behind"), ISSUED + SECOND),
    ).toBe(true);
  });

  it("treats a grant issued after the render, on another server's clock, as new", async () => {
    expect(
      await (
        await openPage()
      ).claimLaunch(grant("future", ISSUED + 5 * SECOND), ISSUED),
    ).toBe(true);
  });
});
