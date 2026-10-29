import { mkdir, readFile, copyFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { writeAtomicText } from "./atomic-write";
import { ORIGINAL_ID, STARRY_ID, starryPackage, type ThemeState } from "../shared/themes";

type Settings = { version: 1; claimedThemeIds: string[]; selectedThemeId: string };
const defaults = (): Settings => ({ version: 1, claimedThemeIds: [], selectedThemeId: ORIGINAL_ID });
const isMissing = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";

/** All settings and package operations are serialized, including competing IPC requests. */
export class ThemeStore {
  private queue: Promise<unknown> = Promise.resolve();
  private warning: string | null = null;
  private initialized = false;
  private settings = defaults();
  private readonly settingsPath: string;
  private readonly packagePath: string;

  constructor(private readonly directory: string) {
    this.settingsPath = join(directory, "appearance.json");
    this.packagePath = join(directory, "themes", "starry.json");
  }

  async initialize(): Promise<void> {
    await mkdir(join(this.directory, "themes"), { recursive: true });
    let raw: string;
    try { raw = await readFile(this.settingsPath, "utf8"); }
    catch (error) {
      if (!isMissing(error)) throw error;
      await this.installPackage();
      await this.save(this.settings);
      this.initialized = true;
      return;
    }
    try {
      const value = JSON.parse(raw);
      if (!value || value.version !== 1 || !Array.isArray(value.claimedThemeIds)
        || typeof value.selectedThemeId !== "string") throw new Error("Invalid appearance settings");
      this.settings = {
        version: 1,
        claimedThemeIds: [...new Set(value.claimedThemeIds.filter((id: unknown): id is string => typeof id === "string"))] as string[],
        selectedThemeId: value.selectedThemeId,
      };
    } catch {
      // Preserve the damaged file for recovery before any subsequent user action writes.
      await copyFile(this.settingsPath, `${this.settingsPath}.recovery-${randomUUID()}`);
      this.warning = "Appearance settings could not be read. A recovery copy was kept in the PRISM data folder. You can claim Starry again for free.";
    }
    this.initialized = true;
  }

  private async installPackage(): Promise<void> {
    await writeAtomicText(this.packagePath, JSON.stringify(starryPackage));
  }

  private async packageAvailable(): Promise<boolean> {
    try {
      const value = JSON.parse(await readFile(this.packagePath, "utf8"));
      return value?.id === STARRY_ID && value.version === starryPackage.version && value.compatibility === starryPackage.compatibility;
    } catch (error) {
      if (error instanceof SyntaxError || isMissing(error)) return false;
      throw error;
    }
  }

  private async save(next: Settings): Promise<void> {
    await writeAtomicText(this.settingsPath, JSON.stringify(next, null, 2));
    this.settings = next;
  }

  private async snapshot(): Promise<ThemeState> {
    const available = await this.packageAvailable();
    const selected = this.settings.selectedThemeId;
    const effective = selected === STARRY_ID && available && this.settings.claimedThemeIds.includes(STARRY_ID)
      ? STARRY_ID : ORIGINAL_ID;
    return {
      claimedThemeIds: [...this.settings.claimedThemeIds],
      selectedThemeId: selected,
      effectiveThemeId: effective,
      availableThemeIds: available ? [ORIGINAL_ID, STARRY_ID] : [ORIGINAL_ID],
      warning: this.warning ?? (!available ? "Starry’s local theme package is missing or incompatible. Your claim is retained. Repair the theme to reinstall it offline."
        : selected !== effective ? "The selected theme is unavailable. PRISM Original is being used without changing your saved selection." : null),
    };
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(async () => {
      if (!this.initialized) await this.initialize();
      return operation();
    });
    this.queue = result.catch(() => undefined);
    return result;
  }

  getState(): Promise<ThemeState> { return this.enqueue(() => this.snapshot()); }

  claim(id: unknown): Promise<ThemeState> {
    return this.enqueue(async () => {
      if (id !== STARRY_ID) throw new Error("This theme is not available in the local catalog.");
      if (!await this.packageAvailable()) throw new Error("Starry’s local package is unavailable. Use Repair Theme, then claim it again.");
      await this.save({ ...this.settings, claimedThemeIds: [...new Set([...this.settings.claimedThemeIds, STARRY_ID])] });
      return this.snapshot();
    });
  }

  apply(id: unknown): Promise<ThemeState> {
    return this.enqueue(async () => {
      if (id !== ORIGINAL_ID && id !== STARRY_ID) throw new Error("Unknown theme.");
      if (id === STARRY_ID && !this.settings.claimedThemeIds.includes(id)) throw new Error("Claim Starry in the Shop before applying it.");
      if (id === STARRY_ID && !await this.packageAvailable()) throw new Error("Starry needs repair before it can be applied.");
      await this.save({ ...this.settings, selectedThemeId: id });
      return this.snapshot();
    });
  }

  repair(id: unknown): Promise<ThemeState> {
    return this.enqueue(async () => {
      if (id !== STARRY_ID) throw new Error("Unknown theme.");
      await this.installPackage();
      return this.snapshot();
    });
  }
}
