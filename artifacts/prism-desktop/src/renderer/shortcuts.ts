export type ShortcutContext =
  | "global"
  | "transport"
  | "arrangement"
  | "piano"
  | "mixer"
  | "effects"
  | "routing"
  | "project";

export type ShortcutCommandId =
  | "transport.toggle"
  | "transport.stop"
  | "transport.home"
  | "transport.record"
  | "transport.loop"
  | "transport.metronome"
  | "transport.stepBack"
  | "transport.stepForward"
  | "project.save"
  | "project.saveAs"
  | "project.export"
  | "project.library"
  | "project.new"
  | "project.open"
  | "project.exit"
  | "edit.undo"
  | "edit.redo"
  | "edit.cut"
  | "edit.copy"
  | "edit.paste"
  | "edit.selectAll"
  | "edit.clearSelection"
  | "edit.duplicate"
  | "edit.delete"
  | "edit.split"
  | "edit.addNote"
  | "edit.toggleSnap"
  | "edit.nudgeLeft"
  | "edit.nudgeRight"
  | "edit.nudgeUp"
  | "edit.nudgeDown"
  | "tool.select"
  | "tool.draw"
  | "tool.erase"
  | "tool.split"
  | "view.zoomIn"
  | "view.zoomOut"
  | "view.zoomReset"
  | "view.fit"
  | "panel.mixer"
  | "panel.piano"
  | "panel.effects"
  | "panel.routing"
  | "mixer.previousTrack"
  | "mixer.nextTrack"
  | "effects.previousTrack"
  | "effects.nextTrack"
  | "help.shortcuts";

export type ShortcutCommand = {
  id: ShortcutCommandId;
  label: string;
  description: string;
  category: ShortcutContext;
  contexts: readonly ShortcutContext[];
  defaultBinding: string;
};

export const shortcutRegistry: readonly ShortcutCommand[] = [
  { id: "transport.toggle", label: "Play or pause", description: "Start or pause the song.", category: "transport", contexts: ["global"], defaultBinding: "Space" },
  { id: "transport.stop", label: "Stop playback", description: "Stop playback without moving the playhead.", category: "transport", contexts: ["global"], defaultBinding: "Escape" },
  { id: "transport.home", label: "Return playhead to start", description: "Stop playback and return to the beginning.", category: "transport", contexts: ["global"], defaultBinding: "Home" },
  { id: "transport.record", label: "Record", description: "Start or stop audio recording.", category: "transport", contexts: ["global"], defaultBinding: "R" },
  { id: "transport.loop", label: "Toggle loop", description: "Enable or disable the loop range.", category: "transport", contexts: ["global"], defaultBinding: "L" },
  { id: "transport.metronome", label: "Toggle metronome", description: "Enable or disable the metronome.", category: "transport", contexts: ["global"], defaultBinding: "K" },
  { id: "transport.stepBack", label: "Move playhead left", description: "Move one grid step in the arrangement.", category: "transport", contexts: ["arrangement"], defaultBinding: "ArrowLeft" },
  { id: "transport.stepForward", label: "Move playhead right", description: "Move one grid step in the arrangement.", category: "transport", contexts: ["arrangement"], defaultBinding: "ArrowRight" },
  { id: "project.save", label: "Save project", description: "Save the current session on this device.", category: "project", contexts: ["global"], defaultBinding: "Mod+S" },
  { id: "project.saveAs", label: "Save project as", description: "Save a separate portable project file.", category: "project", contexts: ["global"], defaultBinding: "Mod+Shift+S" },
  { id: "project.export", label: "Export audio", description: "Render the current song to a WAV file.", category: "project", contexts: ["global"], defaultBinding: "Mod+E" },
  { id: "project.library", label: "Return to project library", description: "Save and leave the current workstation.", category: "project", contexts: ["global"], defaultBinding: "Mod+Shift+H" },
  { id: "project.new", label: "New project", description: "Save the current song and create a new project.", category: "project", contexts: ["global"], defaultBinding: "" },
  { id: "project.open", label: "Open project", description: "Save the current song and open a portable project.", category: "project", contexts: ["global"], defaultBinding: "" },
  { id: "project.exit", label: "Exit PRISM", description: "Save the current song and close PRISM.", category: "project", contexts: ["global"], defaultBinding: "" },
  { id: "edit.undo", label: "Undo", description: "Restore the previous saved edit state.", category: "global", contexts: ["global"], defaultBinding: "Mod+Z" },
  { id: "edit.redo", label: "Redo", description: "Restore the next edit state.", category: "global", contexts: ["global"], defaultBinding: "Mod+Shift+Z" },
  { id: "edit.cut", label: "Cut selection", description: "Copy and remove the selected clip or note.", category: "arrangement", contexts: ["arrangement", "piano"], defaultBinding: "Mod+X" },
  { id: "edit.copy", label: "Copy selection", description: "Copy the selected clip or note.", category: "arrangement", contexts: ["arrangement", "piano"], defaultBinding: "Mod+C" },
  { id: "edit.paste", label: "Paste selection", description: "Paste the copied clip or note.", category: "arrangement", contexts: ["arrangement", "piano"], defaultBinding: "Mod+V" },
  { id: "edit.selectAll", label: "Select all", description: "Select all clips or notes in the active editor.", category: "arrangement", contexts: ["arrangement", "piano"], defaultBinding: "Mod+A" },
  { id: "edit.clearSelection", label: "Clear selection", description: "Clear the current clip or note selection.", category: "arrangement", contexts: ["arrangement", "piano"], defaultBinding: "" },
  { id: "edit.duplicate", label: "Duplicate selection", description: "Copy the selected clip or MIDI note.", category: "arrangement", contexts: ["arrangement", "piano"], defaultBinding: "Mod+D" },
  { id: "edit.delete", label: "Delete selection", description: "Remove the selected clip or MIDI note.", category: "arrangement", contexts: ["arrangement", "piano"], defaultBinding: "Delete" },
  { id: "edit.split", label: "Split selection at playhead", description: "Split the selected clip or MIDI note at the playhead.", category: "arrangement", contexts: ["arrangement", "piano"], defaultBinding: "S" },
  { id: "edit.addNote", label: "Add MIDI note", description: "Create a note at the playhead on the selected MIDI track.", category: "piano", contexts: ["piano"], defaultBinding: "" },
  { id: "edit.toggleSnap", label: "Toggle snap", description: "Turn grid snapping on or off.", category: "arrangement", contexts: ["arrangement", "piano"], defaultBinding: "N" },
  { id: "edit.nudgeLeft", label: "Nudge note left", description: "Move the selected MIDI note one grid step earlier.", category: "piano", contexts: ["piano"], defaultBinding: "ArrowLeft" },
  { id: "edit.nudgeRight", label: "Nudge note right", description: "Move the selected MIDI note one grid step later.", category: "piano", contexts: ["piano"], defaultBinding: "ArrowRight" },
  { id: "edit.nudgeUp", label: "Raise note pitch", description: "Move the selected MIDI note up one semitone.", category: "piano", contexts: ["piano"], defaultBinding: "ArrowUp" },
  { id: "edit.nudgeDown", label: "Lower note pitch", description: "Move the selected MIDI note down one semitone.", category: "piano", contexts: ["piano"], defaultBinding: "ArrowDown" },
  { id: "tool.select", label: "Select tool", description: "Select clips and notes.", category: "arrangement", contexts: ["arrangement", "piano"], defaultBinding: "V" },
  { id: "tool.draw", label: "Draw tool", description: "Create MIDI notes in the active editor.", category: "arrangement", contexts: ["arrangement", "piano"], defaultBinding: "D" },
  { id: "tool.erase", label: "Erase tool", description: "Delete clips or notes by clicking them.", category: "arrangement", contexts: ["arrangement", "piano"], defaultBinding: "E" },
  { id: "tool.split", label: "Split tool", description: "Split a clip or note at the playhead.", category: "arrangement", contexts: ["arrangement", "piano"], defaultBinding: "T" },
  { id: "view.zoomIn", label: "Zoom in", description: "Increase arrangement timeline zoom.", category: "arrangement", contexts: ["arrangement"], defaultBinding: "Mod+ArrowUp" },
  { id: "view.zoomOut", label: "Zoom out", description: "Decrease arrangement timeline zoom.", category: "arrangement", contexts: ["arrangement"], defaultBinding: "Mod+ArrowDown" },
  { id: "view.zoomReset", label: "Reset zoom", description: "Return the timeline to its default zoom.", category: "arrangement", contexts: ["arrangement"], defaultBinding: "Mod+0" },
  { id: "view.fit", label: "Fit selection to view", description: "Fit the selected clip or project duration in the timeline.", category: "arrangement", contexts: ["arrangement"], defaultBinding: "F" },
  { id: "panel.mixer", label: "Open mixer", description: "Show the mixer panel.", category: "mixer", contexts: ["global"], defaultBinding: "F6" },
  { id: "panel.piano", label: "Open piano roll", description: "Show the MIDI editor.", category: "piano", contexts: ["global"], defaultBinding: "F7" },
  { id: "panel.effects", label: "Open effects", description: "Show track, bus, and master effects.", category: "effects", contexts: ["global"], defaultBinding: "F8" },
  { id: "panel.routing", label: "Open routing", description: "Show buses, outputs, and sends.", category: "routing", contexts: ["global"], defaultBinding: "F9" },
  { id: "mixer.previousTrack", label: "Select previous mixer track", description: "Move mixer selection to the previous track.", category: "mixer", contexts: ["mixer"], defaultBinding: "ArrowUp" },
  { id: "mixer.nextTrack", label: "Select next mixer track", description: "Move mixer selection to the next track.", category: "mixer", contexts: ["mixer"], defaultBinding: "ArrowDown" },
  { id: "effects.previousTrack", label: "Select previous effects track", description: "Show effects for the previous track.", category: "effects", contexts: ["effects"], defaultBinding: "Alt+ArrowUp" },
  { id: "effects.nextTrack", label: "Select next effects track", description: "Show effects for the next track.", category: "effects", contexts: ["effects"], defaultBinding: "Alt+ArrowDown" },
  { id: "help.shortcuts", label: "Show keyboard shortcuts", description: "Search, change, import, or export shortcuts.", category: "project", contexts: ["global"], defaultBinding: "Mod+Alt+K" },
] as const;

export type ShortcutBindings = Record<ShortcutCommandId, string>;
export type ShortcutPlatform = "mac" | "other";

export const shortcutStorageKey = "prism.shortcuts.v1";
const commandIds = new Set(shortcutRegistry.map((command) => command.id));
const modifierOrder = ["Mod", "Ctrl", "Alt", "Shift", "Meta"] as const;
const modifierAliases: Record<string, typeof modifierOrder[number]> = {
  mod: "Mod",
  ctrl: "Ctrl",
  control: "Ctrl",
  alt: "Alt",
  shift: "Shift",
  meta: "Meta",
  cmd: "Meta",
  command: "Meta",
};
const keyAliases: Record<string, string> = {
  esc: "Escape",
  spacebar: "Space",
  " ": "Space",
  left: "ArrowLeft",
  right: "ArrowRight",
  up: "ArrowUp",
  down: "ArrowDown",
  del: "Delete",
};

export function getDefaultShortcutBindings(): ShortcutBindings {
  return Object.fromEntries(
    shortcutRegistry.map((command) => [command.id, command.defaultBinding]),
  ) as ShortcutBindings;
}

export function normalizeShortcut(value: string): string | null {
  const pieces = value.split("+").map((piece) => piece.trim()).filter(Boolean);
  if (pieces.length === 0) return null;
  const rawKey = pieces.pop()!;
  const key = keyAliases[rawKey.toLowerCase()] ?? (
    rawKey.length === 1 ? rawKey.toUpperCase() : rawKey
  );
  const validCharacter = /^[A-Z0-9]$/.test(key) || /^[\x21-\x2F\x3A-\x40\x5B-\x60\x7B-\x7E]$/.test(key);
  const validNamedKey = /^(?:Arrow(?:Left|Right|Up|Down)|Space|Escape|Delete|Backspace|Home|End|PageUp|PageDown|Tab|Enter|F(?:[1-9]|1[0-2]))$/.test(key);
  if (!validCharacter && !validNamedKey) {
    return null;
  }
  const modifiers = new Set<typeof modifierOrder[number]>();
  for (const piece of pieces) {
    const modifier = modifierAliases[piece.toLowerCase()];
    if (!modifier || modifiers.has(modifier)) return null;
    modifiers.add(modifier);
  }
  if (modifiers.has("Mod") && (modifiers.has("Ctrl") || modifiers.has("Meta"))) return null;
  return [...modifierOrder.filter((modifier) => modifiers.has(modifier)), key].join("+");
}

export function getShortcutPlatform(platform: string): ShortcutPlatform {
  return /mac|iphone|ipad/i.test(platform) ? "mac" : "other";
}

export function formatShortcut(binding: string, platform: ShortcutPlatform): string {
  const normalized = normalizeShortcut(binding);
  if (!normalized) return "Unassigned";
  return normalized.split("+").map((part) => {
    if (part === "Mod") return platform === "mac" ? "⌘" : "Ctrl";
    if (part === "Meta") return "⌘";
    if (part === "Ctrl") return platform === "mac" ? "⌃" : "Ctrl";
    if (part === "Alt") return platform === "mac" ? "⌥" : "Alt";
    if (part === "Shift") return platform === "mac" ? "⇧" : "Shift";
    if (part === "Space") return "Space";
    return part;
  }).join(platform === "mac" ? "" : "+");
}

export function shortcutFromEvent(event: KeyboardEvent, platform: ShortcutPlatform): string | null {
  if (event.isComposing) return null;
  const key = event.key === " " ? "Space" : event.key;
  if (["Control", "Meta", "Alt", "Shift"].includes(key)) return null;
  const modifiers: string[] = [];
  if (platform === "mac" && event.metaKey) modifiers.push("Mod");
  else if (platform !== "mac" && event.ctrlKey) modifiers.push("Mod");
  if (event.ctrlKey && platform === "mac") modifiers.push("Ctrl");
  if (event.metaKey && platform !== "mac") modifiers.push("Meta");
  if (event.altKey) modifiers.push("Alt");
  if (event.shiftKey) modifiers.push("Shift");
  return normalizeShortcut([...modifiers, key].join("+"));
}

export function matchesShortcut(
  event: KeyboardEvent,
  binding: string,
  platform: ShortcutPlatform,
): boolean {
  const normalized = normalizeShortcut(binding);
  if (!normalized) return false;
  const parts = normalized.split("+");
  const key = parts.pop();
  if (!key) return false;
  const eventKey = event.key === " " ? "Space" : event.key.length === 1
    ? event.key.toUpperCase()
    : keyAliases[event.key.toLowerCase()] ?? event.key;
  if (eventKey !== key) return false;
  const expectsMod = parts.includes("Mod");
  const expectsCtrl = parts.includes("Ctrl") || (expectsMod && platform !== "mac");
  const expectsMeta = parts.includes("Meta") || (expectsMod && platform === "mac");
  return (
    event.ctrlKey === expectsCtrl &&
    event.metaKey === expectsMeta &&
    event.altKey === parts.includes("Alt") &&
    event.shiftKey === parts.includes("Shift")
  );
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== "function") return false;
  return Boolean((target as Element).closest(
    'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]',
  ));
}

export function findShortcutConflicts(
  bindings: Partial<Record<ShortcutCommandId, string>>,
): Array<{ binding: string; commandIds: ShortcutCommandId[] }> {
  const grouped = new Map<string, ShortcutCommand[]>();
  for (const command of shortcutRegistry) {
    const binding = normalizeShortcut(bindings[command.id] ?? "");
    if (!binding) continue;
    grouped.set(binding, [...(grouped.get(binding) ?? []), command]);
  }
  return [...grouped.entries()]
    .map(([binding, commands]) => {
      const commandIds = new Set<ShortcutCommandId>();
      for (let index = 0; index < commands.length; index += 1) {
        for (let otherIndex = index + 1; otherIndex < commands.length; otherIndex += 1) {
          const command = commands[index];
          const other = commands[otherIndex];
          const overlaps = command.contexts.includes("global") ||
            other.contexts.includes("global") ||
            command.contexts.some((context) => other.contexts.includes(context));
          if (overlaps) {
            commandIds.add(command.id);
            commandIds.add(other.id);
          }
        }
      }
      return { binding, commandIds: [...commandIds] };
    })
    .filter((conflict) => conflict.commandIds.length > 1);
}

export function parseShortcutProfile(value: unknown): ShortcutBindings {
  if (!value || typeof value !== "object") throw new Error("Shortcut profile must be a JSON object.");
  const profile = value as { format?: unknown; version?: unknown; bindings?: unknown };
  if (profile.format !== "prism-shortcuts" || profile.version !== 1 ||
      !profile.bindings || typeof profile.bindings !== "object" || Array.isArray(profile.bindings)) {
    throw new Error("This file is not a supported PRISM shortcut profile.");
  }
  const bindings = profile.bindings as Record<string, unknown>;
  const parsed = getDefaultShortcutBindings();
  for (const [id, value] of Object.entries(bindings)) {
    if (!commandIds.has(id as ShortcutCommandId) || typeof value !== "string") {
      throw new Error(`The shortcut profile contains an unknown command: ${id}.`);
    }
    if (value !== "" && !normalizeShortcut(value)) {
      throw new Error(`The shortcut profile has an invalid key for ${id}.`);
    }
    parsed[id as ShortcutCommandId] = value === "" ? "" : normalizeShortcut(value)!;
  }
  return parsed;
}

export function loadShortcutBindings(): { bindings: ShortcutBindings; error: string } {
  const defaults = getDefaultShortcutBindings();
  try {
    const stored = localStorage.getItem(shortcutStorageKey);
    if (!stored) return { bindings: defaults, error: "" };
    const bindings = parseShortcutProfile(JSON.parse(stored));
    const conflicts = findShortcutConflicts(bindings);
    return {
      bindings,
      error: conflicts.length
        ? `Saved shortcut conflicts (${conflicts.map((item) => item.binding).join(", ")}). Resolve them in Preferences > Shortcuts; ambiguous shortcuts will not run.`
        : "",
    };
  } catch (cause) {
    return {
      bindings: defaults,
      error: cause instanceof Error ? cause.message : "Saved shortcuts could not be loaded; defaults are active.",
    };
  }
}

export function serializeShortcutProfile(bindings: ShortcutBindings): string {
  return JSON.stringify({ format: "prism-shortcuts", version: 1, bindings }, null, 2);
}

export function activeShortcutContext(panel: string): ShortcutContext {
  if (panel === "piano" || panel === "sampler" || panel === "drums") return "piano";
  if (panel === "effects") return "effects";
  if (panel === "routing") return "routing";
  if (panel === "mixer" || panel === "devices") return "mixer";
  return "arrangement";
}

export function commandIsActive(command: ShortcutCommand, context: ShortcutContext): boolean {
  return command.contexts.includes("global") || command.contexts.includes(context);
}
