import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ProjectLibrary } from "../shared/migrations";
import type { DrumKitState } from "../shared/types";
import { FACTORY_DRUM_KIT_ID } from "../shared/instrument-library";
import { createFactoryDrumWav, factoryDrumAssetId, factoryDrumSamples } from "../shared/factory-drum-samples";

export async function installFactoryDrums(library: ProjectLibrary, assetDirectory: string, persist: () => Promise<void>): Promise<DrumKitState> {
  for (const sample of factoryDrumSamples) {
    try { await writeFile(join(assetDirectory, `${factoryDrumAssetId(sample.note)}.wav`), createFactoryDrumWav(sample.note), { flag: "wx" }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  }
  const previous = library.assets;
  library.assets = [...previous, ...factoryDrumSamples.filter((sample) =>
    !previous.some((asset) => asset.id === factoryDrumAssetId(sample.note))).map((sample) => ({
      id: factoryDrumAssetId(sample.note), fileName: `PRISM ${sample.name}.wav`,
      storageName: `${factoryDrumAssetId(sample.note)}.wav`, mimeType: "audio/wav",
    }))];
  try { await persist(); } catch (error) { library.assets = previous; throw error; }
  return { instrumentId: FACTORY_DRUM_KIT_ID, patternLengthBars: 1, patternStartBeat: 0,
    pads: factoryDrumSamples.map((sample) => ({
      id: `prism-pad-${sample.note}`, name: sample.name, note: sample.note, gain: 1, sampleAssetId: factoryDrumAssetId(sample.note),
    })) };
}
