import assert from "node:assert/strict";
import test from "node:test";
import {
  createSessionHistory,
  recordSessionSnapshot,
  redoSessionHistory,
  sessionHistoryAvailability,
  undoSessionHistory,
} from "./session-history";

type Session = { title: string; tracks: Array<{ id: string; notes: number[] }> };

function session(title: string, value = 0): Session {
  return { title, tracks: [{ id: "track-a", notes: [value] }] };
}

test("undo and redo restore complete immutable session snapshots", () => {
  const original = session("Original", 60);
  let history = createSessionHistory(original);
  history = recordSessionSnapshot(history, session("Edited", 64));
  original.tracks[0].notes[0] = 12;

  assert.deepEqual(sessionHistoryAvailability(history), { canUndo: true, canRedo: false });
  const undo = undoSessionHistory(history);
  assert.deepEqual(undo.value, session("Original", 60));
  const redo = redoSessionHistory(undo.history);
  assert.deepEqual(redo.value, session("Edited", 64));
  assert.notEqual(redo.value, history.snapshots[1]);
});

test("a new edit after undo discards the stale redo branch", () => {
  let history = createSessionHistory(session("First"));
  history = recordSessionSnapshot(history, session("Second"));
  history = recordSessionSnapshot(history, session("Third"));
  history = undoSessionHistory(history).history;
  history = recordSessionSnapshot(history, session("New branch"));

  assert.equal(history.snapshots.at(-1)?.title, "New branch");
  assert.equal(sessionHistoryAvailability(history).canRedo, false);
});

test("history caps its length and skips unchanged session data", () => {
  let history = createSessionHistory(session("0"));
  assert.equal(recordSessionSnapshot(history, session("0")), history);
  for (let index = 1; index <= 6; index += 1) {
    history = recordSessionSnapshot(history, session(String(index)), 4);
  }
  assert.equal(history.snapshots.length, 4);
  assert.equal(history.snapshots[0].title, "3");
  assert.equal(history.snapshots.at(-1)?.title, "6");
});
