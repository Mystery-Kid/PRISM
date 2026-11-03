import { dialog, type BrowserWindow } from "electron";
import { execFile, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { join, relative, isAbsolute, sep } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { writeAtomicText } from "./atomic-write";
import { decodeNativeSlice } from "../shared/native-contract";
import { validateNativePlugin, type NativeHostStatus, type NativeParameterInfo, type NativePluginInfo, type NativePluginState } from "../shared/native-plugins";

type Config = { sources: string[]; plugins: (NativePluginInfo & { modulePath: string })[]; errors: string[] };
export class NativePluginHost {
  private config: Config = { sources: [], plugins: [], errors: [] };
  private children = new Map<ChildProcess, string>();
  private loading: Promise<void>;
  private scanning = false;
  private completed = 0;
  private total = 0;
  private generation = 0;
  constructor(private directory: string, private executable: string, private parent: () => BrowserWindow | null,
    private smoke?: { source: string; editorCloseAfter: number }) {
    this.loading = this.load();
  }
  private async load() {
    try {
      const saved = JSON.parse(await readFile(join(this.directory, "native-plugins.json"), "utf8"));
      // This local permission registry is never read from a portable project.
      if (Array.isArray(saved.sources)) this.config.sources = saved.sources.filter((p: unknown) => typeof p === "string").slice(0, 16);
      if (Array.isArray(saved.plugins)) this.config.plugins = saved.plugins.slice(0, 4096).filter((p: any) =>
        typeof p.modulePath === "string" && /\.vst3$/i.test(p.modulePath) && /^[a-f\d]{32}$/i.test(p.classId) &&
        typeof p.name === "string" && typeof p.vendor === "string" && typeof p.version === "string" && typeof p.categories === "string" &&
        (p.kind === "instrument" || p.kind === "effect") && this.config.sources.some(source => {
          const child = relative(source, p.modulePath);
          return child && !isAbsolute(child) && child.split(sep)[0] !== "..";
        }));
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") this.config.errors.push("The local plugin registry could not be read. Add its folders again."); }
    if (this.smoke) {
      const source = await realpath(this.smoke.source);
      if (!this.config.sources.includes(source)) { this.config.sources.push(source); await this.persist(); }
    }
  }
  async status(): Promise<NativeHostStatus> {
    await this.loading;
    const available = process.platform === "win32" && existsSync(this.executable);
    return { available, reason: available ? null : "Native VST3 hosting requires the Windows x64 installer with its native component.",
      sources: [...this.config.sources], plugins: this.config.plugins.map(({ modulePath: _, ...plugin }) => plugin),
      errors: [...this.config.errors], scanning: this.scanning, completed: this.completed, total: this.total, generation: this.generation };
  }
  private async persist() {
    await mkdir(this.directory, { recursive: true });
    await writeAtomicText(join(this.directory, "native-plugins.json"), JSON.stringify({ sources: this.config.sources, plugins: this.config.plugins }));
  }
  private async call(args: string[], timeout = 30000, maxBuffer = 4*1024*1024): Promise<string> {
    if (!(await this.status()).available) throw new Error((await this.status()).reason!);
    return new Promise((resolve, reject) => {
      const child = execFile(this.executable, args, { timeout, maxBuffer, windowsHide: true }, (error, stdout, stderr) => {
        this.children.delete(child);
        if (error) reject(new Error(`VST3 process failed or timed out. Project notes/state were kept. ${String(stderr || error.message).slice(0, 2000)}`));
        else resolve(stdout);
      });
      this.children.set(child, args[0]);
    });
  }
  async addFolder() {
    await this.loading;
    if (this.scanning) throw new Error("Wait for the current VST3 scan.");
    const parent = this.parent(); if (!parent) throw new Error("The PRISM window is not available.");
    const chosen = await dialog.showOpenDialog(parent, { title: "Choose a trusted VST3 plugin folder", properties: ["openDirectory"] });
    if (chosen.canceled) return this.status();
    const permission = await dialog.showMessageBox(parent, { type: "warning", title: "Allow executable plugins?",
      message: "VST3 plugins execute native code with your computer's permissions.",
      detail: "Only add folders containing plugins you trust. PRISM will not execute plugins from themes, audio imports or portable projects.",
      buttons: ["Cancel", "Trust and scan folder"], defaultId: 0, cancelId: 0 });
    if (permission.response !== 1) return this.status();
    const folder = await realpath(chosen.filePaths[0]);
    if (!this.config.sources.includes(folder)) {
      if (this.config.sources.length >= 16) throw new Error("Up to 16 plugin source folders are supported.");
      this.config.sources.push(folder);
    }
    await this.persist();
    return this.scan();
  }
  async scan() {
    await this.loading;
    if (this.scanning) throw new Error("A VST3 scan is already in progress.");
    if (!(await this.status()).available) throw new Error((await this.status()).reason!);
    this.scanning = true; this.completed = 0; this.total = 0;
    this.config.plugins = []; this.config.errors = [];
    try {
      const modules: string[] = []; let entries = 0;
      const walk = async (path: string, depth: number): Promise<void> => {
        if (depth > 6 || modules.length >= 128 || entries > 10000) return;
        for (const entry of await readdir(path, { withFileTypes: true })) {
          if (++entries > 10000 || modules.length >= 128) break;
          if (entry.isSymbolicLink()) continue;
          const full = join(path, entry.name);
          if (/\.vst3$/i.test(entry.name)) modules.push(full);
          else if (entry.isDirectory()) await walk(full, depth+1);
        }
      };
      for (const source of this.config.sources) try { await walk(source, 0); }
      catch { this.config.errors.push(`Source unavailable: ${source}`); }
      if (modules.length >= 128 || entries > 10000) this.config.errors.push("Scan limit reached: 128 modules / 10,000 entries / six nested levels. Use smaller source folders.");
      this.total = modules.length;
      for (const modulePath of modules) {
        try {
          const infos = JSON.parse(await this.call(["--scan", modulePath], 8000));
          if (!Array.isArray(infos) || infos.length > 256) throw new Error("Invalid or oversized factory catalog.");
          for (const info of infos) {
            if (!/^[a-f\d]{32}$/i.test(info.id) || typeof info.name !== "string" || typeof info.categories !== "string")
              throw new Error("Invalid plugin identity.");
            if (this.config.plugins.some(p => p.classId === info.id)) {
              this.config.errors.push(`Duplicate ${info.name}: the earlier configured module is used.`); continue;
            }
            this.config.plugins.push({ classId: info.id, name: info.name.slice(0,1000), vendor: String(info.vendor).slice(0,1000),
              version: String(info.version).slice(0,100), categories: info.categories.slice(0,1000),
              kind: info.categories.split("|").includes("Instrument") ? "instrument" : "effect", modulePath });
          }
        } catch (error) { this.config.errors.push(`${modulePath}: ${(error as Error).message}`); }
        this.completed++;
      }
      await this.persist();
    } finally { this.scanning = false; }
    return this.status();
  }
  private find(classId: string) {
    const found = this.config.plugins.find(p => p.classId === classId);
    if (!found) throw new Error("VST3 plugin is missing or not yet scanned. MIDI, audio and saved plugin state were kept. Scan trusted folders, or bypass/remove/replace it.");
    return found;
  }
  async inspect(classId: string): Promise<{ plugin: NativePluginState; parameters: NativeParameterInfo[] }> {
    await this.loading;
    const found = this.find(classId);
    const result = JSON.parse(await this.call(["--inspect", found.modulePath, classId]));
    if (!Array.isArray(result.parameters) || result.parameters.length > 10000) throw new Error("Unsupported VST3 parameter list.");
    const parameters: NativeParameterInfo[] = result.parameters;
    for (const p of parameters) if (!Number.isInteger(p.id) || typeof p.name !== "string" || !Number.isFinite(p.value) || p.value < 0 || p.value > 1)
      throw new Error("Plugin reported invalid parameters.");
    const plugin: NativePluginState = { instanceId: randomUUID(), classId, name: found.name, vendor: found.vendor,
      version: found.version, kind: found.kind, enabled: true, parameters: Object.fromEntries(parameters.filter(p => !p.readOnly).map(p => [p.id, p.value])) };
    validateNativePlugin(plugin);
    return { plugin, parameters };
  }
  private async stateFiles(directory: string, plugin: NativePluginState) {
    const path = join(directory, "state");
    await writeFile(path, plugin.componentState ? Buffer.from(plugin.componentState, "base64") : new Uint8Array());
    if (plugin.controllerState) await writeFile(path+".controller", Buffer.from(plugin.controllerState, "base64"));
    return path;
  }
  async process(input: { plugin: NativePluginState; request: Uint8Array; generation: number }) {
    validateNativePlugin(input?.plugin);
    if (input.generation !== this.generation) throw new Error("Native preparation cancelled.");
    const found = this.find(input.plugin.classId);
    if (input.plugin.kind !== found.kind) throw new Error("Configured plugin type differs from the saved assignment.");
    if (!(input.request instanceof Uint8Array) || input.request.byteLength > 240*1024*1024) throw new Error("Native audio request exceeds the memory limit.");
    const token = this.generation, directory = await mkdtemp(join(tmpdir(), "prism-vst3-"));
    try {
      const request = join(directory, "request"), output = join(directory, "audio");
      await writeFile(request, input.request);
      const state = await this.stateFiles(directory, input.plugin);
      await this.call(["--render", found.modulePath, input.plugin.classId, request, output, state], 180000, 16384);
      if (token !== this.generation) throw new Error("Native preparation cancelled.");
      const bytes = new Uint8Array(await readFile(output));
      decodeNativeSlice(bytes); // Never return truncated/crashed/non-finite output.
      return bytes;
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
  async edit(plugin: NativePluginState) {
    validateNativePlugin(plugin);
    const found = this.find(plugin.classId), directory = await mkdtemp(join(tmpdir(), "prism-vst3-editor-"));
    try {
      const state = await this.stateFiles(directory, plugin), output = join(directory, "edited");
      const values = Object.entries(plugin.parameters), params = Buffer.alloc(4+values.length*12);
      params.writeUInt32LE(values.length, 0);
      values.forEach(([id, value], index) => { params.writeUInt32LE(Number(id), 4+index*12); params.writeDoubleLE(value, 8+index*12); });
      await writeFile(state+".parameters", params);
      await this.call(["--editor", found.modulePath, plugin.classId, state, output,
        ...(this.smoke ? [String(this.smoke.editorCloseAfter)] : [])], 15*60*1000);
      const updated = { ...plugin, componentState: (await readFile(output)).toString("base64"),
        controllerState: (await readFile(output+".controller")).toString("base64") };
      // Native edits supersede generic values. Reusing stale normalized values
      // would overwrite the user's editor changes on the next render.
      updated.parameters = JSON.parse(await readFile(output+".parameters", "utf8"));
      validateNativePlugin(updated);
      return updated;
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
  cancel(all = false) {
    this.generation++;
    for (const [child, mode] of this.children) if (all || mode === "--render") child.kill();
  }
}
