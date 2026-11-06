import {
  DEFAULT_TRACK_HEADER_WIDTH, DEFAULT_TRACK_HEIGHT, MIN_TRACK_HEADER_WIDTH, MAX_TRACK_HEADER_WIDTH,
  MIN_TRACK_HEIGHT, MAX_TRACK_HEIGHT, clampLayoutSize,
} from "./components/arrangement-layout";

export const workspaceKey = "prism.workspace.v1";
export const workspacePanels = ["mixer", "clip", "piano", "sampler", "drums", "effects", "routing", "devices", "native"] as const;
export type WorkspacePanel = typeof workspacePanels[number];
export type WorkspaceLayout = {
  version: 1;
  headerWidth: number;
  trackHeights: Record<string, number>;
  dockHeight: number;
  dockVisible: boolean;
  panel: WorkspacePanel;
};
type StorageReader = Pick<Storage, "getItem">;
export const defaultWorkspace = (): WorkspaceLayout => ({
  version: 1, headerWidth: DEFAULT_TRACK_HEADER_WIDTH, trackHeights: {},
  dockHeight: 220, dockVisible: true, panel: "mixer",
});
const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;
export const isWorkspacePanel = (value: unknown): value is WorkspacePanel =>
  workspacePanels.some(panel => panel === value);

/** Keep arrangement space usable even when restoring a layout from a larger display. */
export function boundDockHeight(value: number, viewportHeight: number): number {
  const maximum = Math.max(150, Math.min(900, finite(viewportHeight, 720) - 330));
  return clampLayoutSize(value, 150, maximum);
}
export function normalizeWorkspace(value: unknown): WorkspaceLayout {
  const defaults = defaultWorkspace();
  if (!object(value) || value.version !== 1) return defaults;
  const trackHeights: Record<string, number> = {};
  if (object(value.trackHeights)) {
    for (const [id, height] of Object.entries(value.trackHeights).slice(-4096)) {
      if (!id || ["__proto__", "constructor", "prototype"].includes(id)) continue;
      trackHeights[id] = clampLayoutSize(finite(height, DEFAULT_TRACK_HEIGHT), MIN_TRACK_HEIGHT, MAX_TRACK_HEIGHT);
    }
  }
  return {
    version: 1,
    headerWidth: clampLayoutSize(finite(value.headerWidth, defaults.headerWidth), MIN_TRACK_HEADER_WIDTH, MAX_TRACK_HEADER_WIDTH),
    trackHeights,
    dockHeight: clampLayoutSize(finite(value.dockHeight, defaults.dockHeight), 150, 900),
    dockVisible: typeof value.dockVisible === "boolean" ? value.dockVisible : defaults.dockVisible,
    panel: isWorkspacePanel(value.panel) ? value.panel : defaults.panel,
  };
}
export function loadWorkspace(storage: StorageReader): WorkspaceLayout {
  try {
    const stored = storage.getItem(workspaceKey);
    if (stored !== null) return normalizeWorkspace(JSON.parse(stored));
    // Preserve existing workspace preferences without ever touching project data.
    const number = (key: string, fallback: number) => {
      const raw = storage.getItem(key);
      return raw !== null && raw.trim() ? Number(raw) : fallback;
    };
    return normalizeWorkspace({
      version: 1,
      headerWidth: number("prism.arrangementHeaderWidth", DEFAULT_TRACK_HEADER_WIDTH),
      trackHeights: JSON.parse(storage.getItem("prism.arrangementTrackHeights") ?? "{}"),
      dockHeight: number("prism.dockHeight", 220),
      dockVisible: storage.getItem("prism.inspectorVisible") !== "false",
      panel: "mixer",
    });
  } catch { return defaultWorkspace(); }
}
