import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeAtomicText } from "./atomic-write";
import { normalizeStoredEffectPreset, visibleEffectPresets } from "../shared/effect-presets";
import type { EffectChainPreset } from "../shared/types";

test("the atomic library writer saves, replaces, and reloads global and project presets", async () => {
  const directory = await mkdtemp(join(tmpdir(), "prism-effect-presets-"));
  const libraryPath = join(directory, "library.json");
  const createdAt = "2026-10-28T12:00:00.000Z";
  const library = {
    version: 3,
    effectPresets: [
      {
        id: "global",
        name: "Global Delay",
        version: 1,
        scope: "global",
        projectId: null,
        effects: [{
          id: "delay-1",
          type: "delay",
          enabled: true,
          parameters: { time: 0.4, feedback: 0.3, mix: 0.2 },
          raw: { id: "delay-1", type: "delay", enabled: true, parameters: { time: 0.4, feedback: 0.3, mix: 0.2 } },
        }],
        createdAt,
        updatedAt: createdAt,
      },
      {
        id: "project-only",
        name: "Release Room",
        version: 1,
        scope: "project",
        projectId: "release-a",
        effects: [{
          id: "vst-future",
          type: "future-room-plugin",
          enabled: true,
          parameters: { size: 9 },
          raw: { id: "vst-future", type: "future-room-plugin", enabled: true, parameters: { size: 9 }, pluginData: { version: "future" } },
        }],
        createdAt,
        updatedAt: createdAt,
      },
    ],
  };
  try {
    await writeAtomicText(libraryPath, JSON.stringify(library));
    const updated = structuredClone(library);
    updated.effectPresets[0]!.name = "Global Delay Renamed";
    await writeAtomicText(libraryPath, JSON.stringify(updated));
    const raw = JSON.parse(await readFile(libraryPath, "utf8")) as { effectPresets: unknown[] };
    const presets = raw.effectPresets.map(normalizeStoredEffectPreset);
    assert.equal(presets[0]?.name, "Global Delay Renamed");
    assert.equal(
      visibleEffectPresets(presets, "release-b").map((preset) => preset.id).join(","),
      "global",
    );
    assert.equal(
      JSON.stringify(presets.find((preset: EffectChainPreset) => preset.id === "project-only")?.effects[0]?.raw.pluginData),
      JSON.stringify({ version: "future" }),
    );
    assert.deepEqual(await readdir(directory), ["library.json"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
