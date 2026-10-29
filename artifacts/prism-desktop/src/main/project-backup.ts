import { randomUUID } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { migrateProjectLibrary, type ProjectLibrary } from "../shared/migrations";

type BackupManifest = {
  format: "PRISM_BACKUP";
  version: 1;
  createdAt: string;
  assetFiles: string[];
};

function isWithin(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === "" || (
    !isAbsolute(path) &&
    path !== ".." &&
    !path.startsWith(`..${sep}`)
  );
}

function assertSafeFileName(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value === "." ||
    value === ".." ||
    value !== basename(value) ||
    value.includes("/") ||
    value.includes("\\")
  ) {
    throw new Error("The backup contains an unsafe file path.");
  }
}

async function readValidatedLibrary(filePath: string): Promise<ProjectLibrary> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    throw new Error("The project library file in this backup is missing or damaged.");
  }
  return migrateProjectLibrary(parsed);
}

async function getRegularFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    assertSafeFileName(entry.name);
    const path = join(directory, entry.name);
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new Error("The project media folder contains a non-file entry that cannot be backed up safely.");
    }
    files.push(entry.name);
  }
  return files.sort();
}

function readManifest(value: unknown): BackupManifest {
  if (typeof value !== "object" || value === null) {
    throw new Error("This is not a valid PRISM backup.");
  }
  const manifest = value as Partial<BackupManifest>;
  if (
    manifest.format !== "PRISM_BACKUP" ||
    manifest.version !== 1 ||
    typeof manifest.createdAt !== "string" ||
    !Array.isArray(manifest.assetFiles) ||
    manifest.assetFiles.some((name) => typeof name !== "string")
  ) {
    throw new Error("This is not a valid PRISM backup.");
  }
  const files = manifest.assetFiles as string[];
  files.forEach(assertSafeFileName);
  if (new Set(files).size !== files.length) {
    throw new Error("The backup lists duplicate media files.");
  }
  return manifest as BackupManifest;
}

export async function createLibraryBackup(
  dataDirectory: string,
  targetParent: string,
  options: { internal?: boolean; label?: string } = {},
): Promise<string> {
  const libraryFile = join(dataDirectory, "library.json");
  const assetsDirectory = join(dataDirectory, "assets");
  const sourceDirectory = await realpath(dataDirectory);
  const sourceAssets = await realpath(assetsDirectory);
  await mkdir(targetParent, { recursive: true });
  const destinationParent = await realpath(targetParent);
  if (
    isWithin(sourceAssets, destinationParent) ||
    (!options.internal && isWithin(sourceDirectory, destinationParent))
  ) {
    throw new Error("Choose a backup location outside PRISM's active project data folder.");
  }

  const library = await readValidatedLibrary(libraryFile);
  const files = await getRegularFiles(assetsDirectory);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const label = options.label ? `${options.label} ` : "";
  const destination = join(
    destinationParent,
    `${label}PRISM Backup ${timestamp}-${randomUUID().slice(0, 8)}`,
  );
  const staging = join(destinationParent, `.${basename(destination)}.tmp-${randomUUID()}`);
  try {
    await mkdir(join(staging, "assets"), { recursive: true });
    await copyFile(libraryFile, join(staging, "library.json"));
    for (const file of files) {
      await copyFile(join(assetsDirectory, file), join(staging, "assets", file));
    }
    const manifest: BackupManifest = {
      format: "PRISM_BACKUP",
      version: 1,
      createdAt: new Date().toISOString(),
      assetFiles: files,
    };
    await writeFile(join(staging, "prism-backup.json"), JSON.stringify(manifest, null, 2), {
      flag: "wx",
    });
    await rename(staging, destination);
    return destination;
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

export async function restoreLibraryBackup(
  backupDirectory: string,
  dataDirectory: string,
): Promise<ProjectLibrary> {
  const requestedBackupRoot = resolve(backupDirectory);
  const backupInfo = await lstat(requestedBackupRoot);
  if (!backupInfo.isDirectory() || backupInfo.isSymbolicLink()) {
    throw new Error("Choose a PRISM backup folder.");
  }
  const backupRoot = await realpath(requestedBackupRoot);
  const activeAssets = await realpath(join(dataDirectory, "assets"));
  if (isWithin(activeAssets, backupRoot)) {
    throw new Error("A backup cannot be restored from inside PRISM's active media folder.");
  }

  let rawManifest: unknown;
  try {
    rawManifest = JSON.parse(await readFile(join(backupRoot, "prism-backup.json"), "utf8"));
  } catch {
    throw new Error("This folder does not contain a readable PRISM backup.");
  }
  const manifest = readManifest(rawManifest);
  const restoredLibrary = await readValidatedLibrary(join(backupRoot, "library.json"));
  const backupAssets = join(backupRoot, "assets");
  const backupAssetRoot = await realpath(backupAssets);
  if (!isWithin(backupRoot, backupAssetRoot)) {
    throw new Error("The backup media folder is outside the selected backup.");
  }
  const availableFiles = await getRegularFiles(backupAssets);
  const available = new Set(availableFiles);
  for (const file of manifest.assetFiles) {
    if (!available.has(file)) throw new Error("A media file listed in the backup is missing.");
  }
  const assetFiles = new Set(manifest.assetFiles);
  if (availableFiles.some((file) => !assetFiles.has(file))) {
    throw new Error("The backup manifest does not include every media file.");
  }
  if (restoredLibrary.assets.some((asset) => !assetFiles.has(asset.storageName))) {
    throw new Error("A project media reference is missing from this backup.");
  }

  const libraryFile = join(dataDirectory, "library.json");
  const assetsDirectory = join(dataDirectory, "assets");
  const internalBackups = join(dataDirectory, "Backups");
  await createLibraryBackup(dataDirectory, internalBackups, {
    internal: true,
    label: "Before Restore",
  });

  const staging = await mkdtemp(join(dataDirectory, ".restore-"));
  const previousAssets = `${assetsDirectory}.before-restore-${randomUUID()}`;
  const previousLibrary = `${libraryFile}.before-restore-${randomUUID()}`;
  let movedPreviousAssets = false;
  let installedNewAssets = false;
  let movedPreviousLibrary = false;
  let installedNewLibrary = false;
  try {
    await mkdir(join(staging, "assets"), { recursive: true });
    await writeFile(join(staging, "library.json"), JSON.stringify(restoredLibrary, null, 2), {
      flag: "wx",
    });
    for (const file of manifest.assetFiles) {
      await copyFile(join(backupAssets, file), join(staging, "assets", file));
    }

    await rename(assetsDirectory, previousAssets);
    movedPreviousAssets = true;
    await rename(join(staging, "assets"), assetsDirectory);
    installedNewAssets = true;
    await rename(libraryFile, previousLibrary);
    movedPreviousLibrary = true;
    await rename(join(staging, "library.json"), libraryFile);
    installedNewLibrary = true;
  } catch (error) {
    if (installedNewLibrary) await unlink(libraryFile).catch(() => undefined);
    if (movedPreviousLibrary) await rename(previousLibrary, libraryFile).catch(() => undefined);
    if (installedNewAssets) await rm(assetsDirectory, { recursive: true, force: true }).catch(() => undefined);
    if (movedPreviousAssets) await rename(previousAssets, assetsDirectory).catch(() => undefined);
    throw error;
  } finally {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
  }

  if (installedNewLibrary && installedNewAssets) {
    await rm(previousAssets, { recursive: true, force: true }).catch(() => undefined);
    await unlink(previousLibrary).catch(() => undefined);
    return restoredLibrary;
  }
  throw new Error("The backup could not be installed. PRISM restored the previous project data.");
}
