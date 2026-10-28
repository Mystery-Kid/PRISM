import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createLibraryBackup, restoreLibraryBackup } from "./project-backup";

async function makeLibrary(root: string, title: string, media: string) {
  const dataDirectory = join(root, title.replaceAll(" ", "-"));
  const assetsDirectory = join(dataDirectory, "assets");
  await mkdir(assetsDirectory, { recursive: true });
  const storageName = `${randomUUID()}.wav`;
  const library = {
    version: 3,
    releases: [{
      id: randomUUID(),
      title,
      artistName: "PRISM Test",
      releaseType: "Single",
      customReleaseType: "",
      description: "",
      artworkAssetId: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      lastOpenedAt: null,
      songIds: [],
    }],
    sessions: [],
    assets: [{
      id: randomUUID(),
      fileName: `${title}.wav`,
      mimeType: "audio/wav",
      storageName,
    }],
  };
  await writeFile(join(dataDirectory, "library.json"), JSON.stringify(library, null, 2));
  await writeFile(join(assetsDirectory, storageName), media);
  return { dataDirectory, library, storageName };
}

test("library backup includes the project metadata and all media files", async () => {
  const root = await mkdtemp(join(tmpdir(), "prism-backup-test-"));
  try {
    const source = await makeLibrary(root, "Song One", "audio bytes");
    const backup = await createLibraryBackup(source.dataDirectory, join(root, "exports"));

    assert.deepEqual(
      JSON.parse(await readFile(join(backup, "library.json"), "utf8")),
      source.library,
    );
    assert.equal(
      await readFile(join(backup, "assets", source.storageName), "utf8"),
      "audio bytes",
    );
    const manifest = JSON.parse(await readFile(join(backup, "prism-backup.json"), "utf8"));
    assert.deepEqual(manifest.assetFiles, [source.storageName]);
    assert.equal(manifest.format, "PRISM_BACKUP");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("restore replaces the library and media after creating a safety backup", async () => {
  const root = await mkdtemp(join(tmpdir(), "prism-restore-test-"));
  try {
    const backupSource = await makeLibrary(root, "Restored Song", "restored audio");
    const backup = await createLibraryBackup(backupSource.dataDirectory, join(root, "exports"));
    const current = await makeLibrary(root, "Current Song", "current audio");

    const restored = await restoreLibraryBackup(backup, current.dataDirectory);

    assert.equal(restored.releases[0].title, "Restored Song");
    assert.equal(
      await readFile(join(current.dataDirectory, "assets", backupSource.storageName), "utf8"),
      "restored audio",
    );
    const backupFolders = await readdir(join(current.dataDirectory, "Backups"));
    assert.equal(backupFolders.length, 1);
    const safetyCopy = JSON.parse(await readFile(
      join(current.dataDirectory, "Backups", backupFolders[0], "library.json"),
      "utf8",
    ));
    assert.equal(safetyCopy.releases[0].title, "Current Song");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("backup creation refuses to write inside the active media folder", async () => {
  const root = await mkdtemp(join(tmpdir(), "prism-backup-path-test-"));
  try {
    const source = await makeLibrary(root, "Safe Song", "audio");
    await assert.rejects(
      createLibraryBackup(source.dataDirectory, join(source.dataDirectory, "assets")),
      /outside PRISM's active project data folder/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("restore rejects a backup manifest with a path traversal entry", async () => {
  const root = await mkdtemp(join(tmpdir(), "prism-restore-path-test-"));
  try {
    const source = await makeLibrary(root, "Backup Song", "backup audio");
    const backup = await createLibraryBackup(source.dataDirectory, join(root, "exports"));
    await writeFile(
      join(backup, "prism-backup.json"),
      JSON.stringify({
        format: "PRISM_BACKUP",
        version: 1,
        createdAt: "2026-01-01T00:00:00.000Z",
        assetFiles: ["../../outside.wav"],
      }),
    );
    const current = await makeLibrary(root, "Keep This Song", "keep audio");

    await assert.rejects(
      restoreLibraryBackup(backup, current.dataDirectory),
      /unsafe file path/,
    );
    assert.equal(
      JSON.parse(await readFile(join(current.dataDirectory, "library.json"), "utf8"))
        .releases[0].title,
      "Keep This Song",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
