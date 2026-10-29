import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ThemeStore } from "./theme-store";
import { ORIGINAL_ID, STARRY_ID } from "../shared/themes";

async function fixture(t: { after: (callback: () => Promise<void>) => void }) {
  const directory = await mkdtemp(join(tmpdir(), "prism-theme-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new ThemeStore(directory);
  await store.initialize();
  return { store, directory };
}

test("offline claims are durable and do not implicitly change the selected theme", async (t) => {
  const { store, directory } = await fixture(t);
  assert.equal((await store.getState()).effectiveThemeId, ORIGINAL_ID);
  const claimed = await store.claim(STARRY_ID);
  assert.deepEqual(claimed.claimedThemeIds, [STARRY_ID]);
  assert.equal(claimed.selectedThemeId, ORIGINAL_ID);
  const restarted = new ThemeStore(directory);
  await restarted.initialize();
  assert.deepEqual((await restarted.getState()).claimedThemeIds, [STARRY_ID]);
  assert.equal((await restarted.getState()).selectedThemeId, ORIGINAL_ID);
});

test("claiming concurrently is idempotent and selection survives restart independently", async (t) => {
  const { store, directory } = await fixture(t);
  await Promise.all(Array.from({ length: 12 }, () => store.claim(STARRY_ID)));
  assert.deepEqual((await store.getState()).claimedThemeIds, [STARRY_ID]);
  assert.equal((await store.apply(STARRY_ID)).effectiveThemeId, STARRY_ID);
  let restarted = new ThemeStore(directory);
  await restarted.initialize();
  assert.equal((await restarted.getState()).effectiveThemeId, STARRY_ID);
  await restarted.apply(ORIGINAL_ID);
  restarted = new ThemeStore(directory);
  await restarted.initialize();
  assert.equal((await restarted.getState()).effectiveThemeId, ORIGINAL_ID);
  assert.deepEqual((await restarted.getState()).claimedThemeIds, [STARRY_ID]);
});

test("unclaimed, unknown and path-like theme IDs are rejected at the store boundary", async (t) => {
  const { store } = await fixture(t);
  await assert.rejects(store.apply(STARRY_ID), /Claim Starry/);
  for (const id of ["../../outside", "theme.fake", null, { id: STARRY_ID }]) {
    await assert.rejects(store.claim(id), /not available/);
    await assert.rejects(store.apply(id), /Unknown theme/);
    await assert.rejects(store.repair(id), /Unknown theme/);
  }
  // A rejected operation must not poison the serialization queue.
  assert.deepEqual((await store.claim(STARRY_ID)).claimedThemeIds, [STARRY_ID]);
});

test("missing packages retain claims and selected preference, fall back, and repair offline", async (t) => {
  const { store, directory } = await fixture(t);
  await store.claim(STARRY_ID);
  await store.apply(STARRY_ID);
  await rm(join(directory, "themes", "starry.json"));
  const restarted = new ThemeStore(directory);
  await restarted.initialize();
  const missing = await restarted.getState();
  assert.deepEqual(missing.claimedThemeIds, [STARRY_ID]);
  assert.equal(missing.selectedThemeId, STARRY_ID);
  assert.equal(missing.effectiveThemeId, ORIGINAL_ID);
  assert.match(missing.warning!, /Repair/);
  await assert.rejects(restarted.apply(STARRY_ID), /repair/);
  await assert.rejects(restarted.claim(STARRY_ID), /Repair/);
  assert.equal((await restarted.repair(STARRY_ID)).effectiveThemeId, STARRY_ID);
  assert.equal((await restarted.getState()).warning, null);
});

test("malformed and incompatible local packages can be repaired without losing claims", async (t) => {
  const { store, directory } = await fixture(t);
  await store.claim(STARRY_ID);
  for (const text of ["{broken", "null", "[]", '{"id":"theme.starry","version":999,"compatibility":1}']) {
    await writeFile(join(directory, "themes", "starry.json"), text);
    assert.ok(!(await store.getState()).availableThemeIds.includes(STARRY_ID));
    await assert.rejects(store.claim(STARRY_ID), /Repair/);
    assert.deepEqual((await store.repair(STARRY_ID)).claimedThemeIds, [STARRY_ID]);
  }
});

test("damaged settings are preserved as a recovery copy with a visible warning", async (t) => {
  const { directory } = await fixture(t);
  await writeFile(join(directory, "appearance.json"), "{damaged");
  const restarted = new ThemeStore(directory);
  await restarted.initialize();
  assert.match((await restarted.getState()).warning!, /recovery copy/);
  const backup = (await readdir(directory)).find((name) => name.startsWith("appearance.json.recovery-"));
  assert.ok(backup);
  assert.equal(await readFile(join(directory, backup), "utf8"), "{damaged");
  assert.equal((await restarted.claim(STARRY_ID)).effectiveThemeId, ORIGINAL_ID);
});

test("unknown entitlements and future selected IDs are retained instead of silently removed", async (t) => {
  const { directory } = await fixture(t);
  await writeFile(join(directory, "appearance.json"), JSON.stringify({
    version: 1, claimedThemeIds: [STARRY_ID, STARRY_ID, "theme.future", 5], selectedThemeId: "theme.future",
  }));
  const restarted = new ThemeStore(directory);
  await restarted.initialize();
  const state = await restarted.getState();
  assert.deepEqual(state.claimedThemeIds, [STARRY_ID, "theme.future"]);
  assert.equal(state.selectedThemeId, "theme.future");
  assert.equal(state.effectiveThemeId, ORIGINAL_ID);
  assert.match(state.warning!, /unavailable/);
});

test("theme writes are isolated from project data and failed saves do not update memory", async (t) => {
  const { store, directory } = await fixture(t);
  const library = '{"projects":["do-not-change"]}';
  await writeFile(join(directory, "library.json"), library);
  await store.claim(STARRY_ID);
  await store.apply(STARRY_ID);
  assert.equal(await readFile(join(directory, "library.json"), "utf8"), library);
  // A directory at the settings destination forces the atomic rename to fail.
  await rm(join(directory, "appearance.json"));
  const { mkdir } = await import("node:fs/promises");
  await mkdir(join(directory, "appearance.json"));
  await assert.rejects(store.apply(ORIGINAL_ID));
  assert.equal((await store.getState()).selectedThemeId, STARRY_ID);
});

test("initialization failures can be retried after the local storage problem is corrected", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "prism-theme-retry-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, "themes"), "blocks the theme directory");
  const store = new ThemeStore(directory);
  await assert.rejects(store.initialize());
  await assert.rejects(store.getState());
  await rm(join(directory, "themes"));
  assert.equal((await store.getState()).effectiveThemeId, ORIGINAL_ID);
  assert.deepEqual((await store.claim(STARRY_ID)).claimedThemeIds, [STARRY_ID]);
});
