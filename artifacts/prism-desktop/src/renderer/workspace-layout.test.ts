import assert from "node:assert/strict";
import test from "node:test";
import { boundDockHeight, defaultWorkspace, loadWorkspace, normalizeWorkspace, workspaceKey } from "./workspace-layout";

const storage = (values: Record<string, string>) => ({ getItem: (key: string) => values[key] ?? null });
test("workspace defaults and malformed versions are safe", () => {
  for (const value of [null, [], "x", { version: 2 }]) assert.deepEqual(normalizeWorkspace(value), defaultWorkspace());
  assert.deepEqual(loadWorkspace(storage({ [workspaceKey]: "{invalid" })), defaultWorkspace());
});
test("workspace rejects nonfinite dimensions and unsafe track keys", () => {
  const layout = normalizeWorkspace({
    version: 1, headerWidth: Infinity, dockHeight: -99, dockVisible: "false", panel: "imaginary",
    trackHeights: JSON.parse('{"__proto__":123,"one":1,"two":999,"three":"200"}'),
  });
  assert.equal(layout.headerWidth, 240);
  assert.equal(layout.dockHeight, 150);
  assert.equal(layout.dockVisible, true);
  assert.equal(layout.panel, "mixer");
  assert.deepEqual(layout.trackHeights, { one: 82, two: 220, three: 112 });
});
test("legacy dimensions migrate while musical content is excluded", () => {
  const layout = loadWorkspace(storage({
    "prism.arrangementHeaderWidth": "315.5", "prism.arrangementTrackHeights": '{"track-a":169}',
    "prism.dockHeight": "410", "prism.inspectorVisible": "false",
  }));
  assert.equal(layout.headerWidth, 315.5);
  assert.equal(layout.trackHeights["track-a"], 169);
  assert.equal(layout.dockHeight, 410);
  assert.equal(layout.dockVisible, false);
  assert.deepEqual(Object.keys(layout).sort(), ["version", "headerWidth", "trackHeights", "dockHeight", "dockVisible", "panel"].sort());
});
test("complete workspace round trip preserves active panel and independent heights", () => {
  const layout = { ...defaultWorkspace(), panel: "effects" as const, trackHeights: { a: 95, b: 201 }, dockVisible: false };
  assert.deepEqual(loadWorkspace(storage({ [workspaceKey]: JSON.stringify(layout) })), layout);
});
test("dock leaves usable arrangement space on smaller displays", () => {
  assert.equal(boundDockHeight(850, 720), 390);
  assert.equal(boundDockHeight(850, 1080), 750);
  assert.equal(boundDockHeight(20, 480), 150);
  assert.equal(boundDockHeight(NaN, 720), 150);
});
