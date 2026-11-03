export type NativePluginState = {
  instanceId: string; classId: string; name: string; vendor: string; version: string;
  kind: "instrument" | "effect"; enabled: boolean;
  parameters: Record<string, number>;
  componentState?: string; controllerState?: string;
};
export type NativePluginInfo = {
  classId: string; name: string; vendor: string; version: string; categories: string;
  kind: "instrument" | "effect";
};
export type NativeParameterInfo = {
  id: number; name: string; unit: string; value: number; steps: number; readOnly: boolean;
};
export type NativeHostStatus = {
  available: boolean; reason: string | null; sources: string[];
  plugins: NativePluginInfo[]; errors: string[]; scanning: boolean; completed: number; total: number;
  generation: number;
};
export type NativePluginBridge = {
  nativePluginStatus(): Promise<NativeHostStatus>;
  addNativePluginFolder(): Promise<NativeHostStatus>;
  scanNativePlugins(): Promise<NativeHostStatus>;
  inspectNativePlugin(classId: string): Promise<{ plugin: NativePluginState; parameters: NativeParameterInfo[] }>;
  editNativePlugin(plugin: NativePluginState): Promise<NativePluginState>;
  processNativePlugin(input: { plugin: NativePluginState; request: Uint8Array; generation: number }): Promise<Uint8Array>;
  cancelNativeProcessing(): Promise<void>;
};
export function validateNativePlugin(value: unknown): asserts value is NativePluginState {
  if (!value || typeof value !== "object") throw new Error("Invalid VST3 state; the original project was not changed.");
  const p = value as NativePluginState;
  if (typeof p.instanceId !== "string" || !p.instanceId || p.instanceId.length > 200 ||
    typeof p.classId !== "string" || !/^[a-f\d]{32}$/i.test(p.classId) || typeof p.name !== "string" || p.name.length > 1000 ||
    typeof p.vendor !== "string" || p.vendor.length > 1000 || typeof p.version !== "string" || p.version.length > 100 ||
    (p.kind !== "instrument" && p.kind !== "effect") || typeof p.enabled !== "boolean" ||
    !p.parameters || typeof p.parameters !== "object" || Array.isArray(p.parameters) ||
    Object.keys(p.parameters).length > 10000 || Object.entries(p.parameters).some(([id, v]) =>
      !/^\d{1,10}$/.test(id) || Number(id) > 0xffffffff || !Number.isFinite(v) || v < 0 || v > 1) ||
    [p.componentState, p.controllerState].some(s => s !== undefined &&
      (typeof s !== "string" || s.length > 22369624 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(s))))
    throw new Error("Unsupported or malformed VST3 state; keep the original project for recovery.");
}
export function validateNativeSession(session: {
  tracks: { nativeInstrument?: NativePluginState | null; nativeEffects?: NativePluginState[] }[];
  buses?: { nativeEffects?: NativePluginState[] }[]; nativeMasterEffects?: NativePluginState[];
}) {
  const plugins: NativePluginState[] = [];
  const effects = (chain: NativePluginState[] | undefined) => {
    if (chain === undefined) return;
    if (!Array.isArray(chain) || chain.length > 32) throw new Error("VST3 chains support at most 32 plugins.");
    chain.forEach(p => { validateNativePlugin(p); if (p.kind !== "effect") throw new Error("Invalid native effect role."); plugins.push(p); });
  };
  for (const track of session.tracks) {
    if (track.nativeInstrument) {
      validateNativePlugin(track.nativeInstrument);
      if (track.nativeInstrument.kind !== "instrument") throw new Error("Invalid native instrument role.");
      plugins.push(track.nativeInstrument);
    }
    effects(track.nativeEffects);
  }
  session.buses?.forEach(b => effects(b.nativeEffects)); effects(session.nativeMasterEffects);
  if (new Set(plugins.map(p => p.instanceId)).size !== plugins.length) throw new Error("Native plugin instance identities must be unique.");
  if (plugins.reduce((size,p) => size+(p.componentState?.length ?? 0)+(p.controllerState?.length ?? 0),0) > 89_478_488)
    throw new Error("Native plugin state exceeds the 64 MiB per-song limit. The original project was not changed.");
}
