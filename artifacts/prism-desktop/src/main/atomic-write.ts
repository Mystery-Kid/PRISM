import { randomUUID } from "node:crypto";
import { rename, unlink, writeFile } from "node:fs/promises";

export async function writeAtomicText(filePath: string, contents: string): Promise<void> {
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, contents, { encoding: "utf8", flag: "wx" });
    await rename(temporaryPath, filePath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}
