// Unit tests for the ingest task state machine.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ALLOWED_TRANSITIONS, IngestTask, TASK_STATES } from "../src/ingest/task-state.js";

const HAPPY_PATH = [
  "preflighted",
  "awaiting_confirmation",
  "planned",
  "awaiting_write_confirmation",
  "writing",
  "validating",
  "compiling",
  "completed",
];

function makeTask() {
  return new IngestTask({ taskId: "t1", source: { sourceUri: "mem://x" } });
}

test("task follows the documented transition order to completed", () => {
  const task = makeTask();
  assert.equal(task.state, "pending");
  assert.equal(task.getState(), "pending");
  for (const state of HAPPY_PATH) {
    task.transition(state);
    assert.equal(task.state, state);
  }
  assert.equal(task.getState(), "completed");
  assert.throws(() => task.transition("bogus"), /unknown task state/);
});

test("illegal transitions are rejected and leave the state unchanged", () => {
  const task = makeTask();
  // The old test encoded pending -> compiling; that jump must now be illegal.
  assert.throws(() => task.transition("compiling"), /illegal task transition pending -> compiling/);
  assert.equal(task.state, "pending");
  task.transition("preflighted");
  assert.throws(() => task.transition("completed"), /illegal task transition preflighted -> completed/);
  assert.equal(task.state, "preflighted");
  // `cancelled` is only reachable while a confirmation gate is pending.
  assert.throws(() => task.transition("cancelled"), /illegal task transition preflighted -> cancelled/);
});

test("terminal states cannot transition further", () => {
  const task = makeTask();
  for (const state of HAPPY_PATH) task.transition(state);
  assert.throws(() => task.transition("pending"), /illegal task transition completed -> pending/);
  const failed = makeTask().transition("failed");
  assert.throws(() => failed.transition("preflighted"), /illegal task transition failed -> preflighted/);
});

test("constructor validates the initial state and task id", () => {
  assert.throws(() => new IngestTask({ taskId: "t", state: "bogus" }), /unknown task state/);
  assert.throws(() => new IngestTask({ taskId: "", state: "pending" }), /taskId is required/);
  const restored = new IngestTask({ taskId: "t", state: "writing" });
  assert.equal(restored.state, "writing");
});

test("external state assignment is blocked; only transition() moves state", () => {
  const task = makeTask();
  assert.throws(() => {
    task.state = "completed";
  }, TypeError);
  assert.equal(task.state, "pending");
});

test("transition records a state_change step with from/to and a timestamp", () => {
  const task = makeTask();
  task.transition("preflighted");
  const last = task.steps.at(-1);
  assert.equal(last.step, "state_change");
  assert.deepEqual(last.detail, { from: "pending", to: "preflighted" });
  assert.equal(last.at, task.updatedAt);
  assert.ok(!Number.isNaN(Date.parse(last.at)));
  // An illegal transition must not append an audit step.
  const before = task.steps.length;
  assert.throws(() => task.transition("completed"), /illegal task transition/);
  assert.equal(task.steps.length, before);
});

test("fromJSON restores a persisted task and validates its fields", () => {
  const task = makeTask();
  task.transition("preflighted").log("preflight", "ok");
  task.transition("awaiting_confirmation");

  const restored = IngestTask.fromJSON(JSON.parse(JSON.stringify(task.toJSON())));
  assert.equal(restored.taskId, "t1");
  assert.equal(restored.state, "awaiting_confirmation");
  assert.equal(restored.steps.length, 3);
  assert.equal(restored.steps[0].step, "state_change");
  assert.deepEqual(restored.steps[0].detail, { from: "pending", to: "preflighted" });
  assert.equal(restored.steps[1].step, "preflight");
  assert.deepEqual(restored.steps[2].detail, { from: "preflighted", to: "awaiting_confirmation" });
  assert.equal(restored.createdAt, task.createdAt);
  assert.equal(restored.updatedAt, task.updatedAt);
  restored.transition("cancelled");
  assert.equal(restored.state, "cancelled");
  assert.equal(restored.steps.at(-1).step, "state_change");

  assert.throws(() => IngestTask.fromJSON(null), /data must be an object/);
  assert.throws(() => IngestTask.fromJSON([]), /data must be an object/);
  assert.throws(() => IngestTask.fromJSON({ ...task.toJSON(), taskId: " " }), /taskId is required/);
  assert.throws(() => IngestTask.fromJSON({ ...task.toJSON(), state: "bogus" }), /unknown task state/);
  assert.throws(() => IngestTask.fromJSON({ ...task.toJSON(), steps: {} }), /steps must be an array/);
  assert.throws(() => IngestTask.fromJSON({ ...task.toJSON(), steps: [{ step: 1 }] }), /every step/);
  assert.throws(
    () => IngestTask.fromJSON({ ...task.toJSON(), createdAt: "not-a-date" }),
    /createdAt must be an ISO timestamp/,
  );
});

test("state list and edge table are frozen", () => {
  assert.ok(Object.isFrozen(TASK_STATES));
  assert.ok(Object.isFrozen(ALLOWED_TRANSITIONS));
  assert.ok(Object.isFrozen(ALLOWED_TRANSITIONS.pending));
  assert.throws(() => TASK_STATES.push("bogus"), TypeError);
  assert.throws(() => ALLOWED_TRANSITIONS.pending.push("completed"), TypeError);
});
