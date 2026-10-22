// Unit tests for the ingest task state machine.
import { test } from "node:test";
import assert from "node:assert/strict";
import { IngestTask, TASK_STATES } from "../src/ingest/task-state.js";

test("task transitions through documented states and rejects unknown ones", () => {
  const task = new IngestTask({ taskId: "t1", source: { sourceUri: "mem://x" } });
  assert.equal(task.state, "pending");
  task.transition("preflighted").transition("compiling").transition("completed");
  assert.equal(task.state, "completed");
  assert.throws(() => task.transition("bogus"), /unknown task state/);
  assert.ok(TASK_STATES.includes("needs_review"));
});
