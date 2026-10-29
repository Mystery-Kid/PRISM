import assert from "node:assert/strict";
import test from "node:test";
import {
  findShortcutConflicts,
  formatShortcut,
  getDefaultShortcutBindings,
  getShortcutPlatform,
  isEditableTarget,
  matchesShortcut,
  normalizeShortcut,
  parseShortcutProfile,
  serializeShortcutProfile,
  shortcutFromEvent,
} from "./shortcuts";

function keyEvent(overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    key: "s",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    isComposing: false,
    ...overrides,
  } as KeyboardEvent;
}

test("normalizes common key names and rejects incomplete or malformed bindings", () => {
  assert.equal(normalizeShortcut("control + shift + z"), "Ctrl+Shift+Z");
  assert.equal(normalizeShortcut("cmd+s"), "Meta+S");
  assert.equal(normalizeShortcut("Spacebar"), "Space");
  assert.equal(normalizeShortcut("Control+Mod+S"), null);
  assert.equal(normalizeShortcut("Ctrl+DefinitelyNotAKey"), null);
  assert.equal(normalizeShortcut("Shift+"), null);
});

test("Mod resolves to the platform modifier and checks modifiers exactly", () => {
  assert.equal(matchesShortcut(keyEvent({ key: "s", ctrlKey: true }), "Mod+S", "other"), true);
  assert.equal(matchesShortcut(keyEvent({ key: "s", metaKey: true }), "Mod+S", "mac"), true);
  assert.equal(matchesShortcut(keyEvent({ key: "s", ctrlKey: true, shiftKey: true }), "Mod+S", "other"), false);
  assert.equal(matchesShortcut(keyEvent({ key: "s", ctrlKey: true }), "Meta+S", "other"), false);
  assert.equal(getShortcutPlatform("MacIntel"), "mac");
  assert.equal(getShortcutPlatform("Win32"), "other");
  assert.equal(formatShortcut("Mod+Shift+Z", "other"), "Ctrl+Shift+Z");
  assert.equal(formatShortcut("Mod+Shift+Z", "mac"), "⌘⇧Z");
});

test("recorded keys preserve modifiers and ignore IME and modifier-only events", () => {
  assert.equal(shortcutFromEvent(keyEvent({ key: "S", ctrlKey: true, shiftKey: true }), "other"), "Mod+Shift+S");
  assert.equal(shortcutFromEvent(keyEvent({ key: "Control", ctrlKey: true }), "other"), null);
  assert.equal(shortcutFromEvent(keyEvent({ key: "s", isComposing: true }), "other"), null);
  assert.equal(shortcutFromEvent(keyEvent({ key: " ", shiftKey: false }), "other"), "Space");
});

test("editable controls can be excluded from global shortcut handling", () => {
  const target = {
    closest: (selector: string) => selector.includes("input") ? {} : null,
  } as unknown as EventTarget;
  assert.equal(isEditableTarget(target), true);
  assert.equal(isEditableTarget({} as EventTarget), false);
  assert.equal(isEditableTarget(null), false);
});

test("shortcut profiles round-trip and reject unknown commands and invalid keys", () => {
  const bindings = getDefaultShortcutBindings();
  bindings["project.save"] = "Ctrl+Shift+S";
  const profile = serializeShortcutProfile(bindings);
  assert.deepEqual(parseShortcutProfile(JSON.parse(profile)), bindings);
  assert.throws(() => parseShortcutProfile({ format: "wrong", version: 1, bindings: {} }), /supported PRISM/);
  assert.throws(() => parseShortcutProfile({
    format: "prism-shortcuts", version: 1, bindings: { "bad.command": "Mod+S" },
  }), /unknown command/);
  assert.throws(() => parseShortcutProfile({
    format: "prism-shortcuts", version: 1, bindings: { "project.save": "Mod+Nope" },
  }), /invalid key/);
});

test("binding conflicts only apply where command contexts overlap", () => {
  const defaults = getDefaultShortcutBindings();
  assert.deepEqual(findShortcutConflicts(defaults), []);
  defaults["edit.undo"] = "Mod+D";
  assert.deepEqual(findShortcutConflicts(defaults), [{
    binding: "Mod+D",
    commandIds: ["edit.undo", "edit.duplicate"],
  }]);
  defaults["edit.undo"] = "Mod+Z";
  defaults["edit.nudgeLeft"] = "ArrowLeft";
  assert.deepEqual(findShortcutConflicts(defaults), []);
});
