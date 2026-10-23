// Task state machine for ingest (P3), persisted as JSON so a run can be
// resumed after interruption. States follow the plan: pending -> preflighted
// -> awaiting_confirmation -> planned -> awaiting_write_confirmation ->
// writing -> validating -> compiling -> completed, plus failed/needs_review/
// cancelled/partial.
//
// Transitions are guarded by an explicit edge table, so a state can only move
// forward along the documented flow (or stop at a terminal outcome). The state
// itself is private: callers read it and move it through transition() only.

export const TASK_STATES = Object.freeze([
  "pending",
  "preflighted",
  "awaiting_confirmation",
  "planned",
  "awaiting_write_confirmation",
  "writing",
  "validating",
  "compiling",
  "completed",
  "failed",
  "needs_review",
  "cancelled",
  "partial",
]);

// Every active state may end in `failed`; `cancelled` is only reachable while a
// confirmation gate is pending. Terminal states have no outgoing edges.
export const ALLOWED_TRANSITIONS = Object.freeze({
  pending: Object.freeze(["preflighted", "failed"]),
  preflighted: Object.freeze(["awaiting_confirmation", "failed"]),
  awaiting_confirmation: Object.freeze(["planned", "cancelled", "failed"]),
  planned: Object.freeze(["awaiting_write_confirmation", "failed"]),
  awaiting_write_confirmation: Object.freeze(["writing", "cancelled", "failed"]),
  writing: Object.freeze(["validating", "needs_review", "failed"]),
  validating: Object.freeze(["compiling", "failed", "partial"]),
  compiling: Object.freeze(["completed", "partial", "failed"]),
  completed: Object.freeze([]),
  failed: Object.freeze([]),
  needs_review: Object.freeze([]),
  cancelled: Object.freeze([]),
  partial: Object.freeze([]),
});

function assertKnownState(state, label) {
  if (!TASK_STATES.includes(state)) {
    throw new Error(`${label}: unknown task state "${state}"`);
  }
}

export class IngestTask {
  #state;

  constructor({ taskId, source, state = "pending" }) {
    if (typeof taskId !== "string" || !taskId.trim()) {
      throw new Error("IngestTask: taskId is required");
    }
    assertKnownState(state, "IngestTask");
    this.taskId = taskId;
    this.source = source;
    this.#state = state;
    this.steps = [];
    this.createdAt = new Date().toISOString();
    this.updatedAt = this.createdAt;
  }

  get state() {
    return this.#state;
  }

  getState() {
    return this.#state;
  }

  transition(nextState) {
    assertKnownState(nextState, "IngestTask.transition");
    const previous = this.#state;
    const allowed = ALLOWED_TRANSITIONS[previous];
    if (!allowed.includes(nextState)) {
      throw new Error(`illegal task transition ${previous} -> ${nextState}`);
    }
    this.#state = nextState;
    const at = new Date().toISOString();
    this.updatedAt = at;
    // Record the audit trail (from/to/when) so a restored task can explain how it
    // reached its persisted state.
    this.steps.push({ step: "state_change", detail: { from: previous, to: nextState }, at });
    return this;
  }

  log(step, detail) {
    this.steps.push({ step, detail, at: new Date().toISOString() });
    this.updatedAt = new Date().toISOString();
    return this;
  }

  // Restore a persisted task, validating the fields that drive the state
  // machine so a corrupt task file cannot bypass the edge table later.
  static fromJSON(data) {
    if (data === null || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("IngestTask.fromJSON: data must be an object");
    }
    const { taskId, source, state, steps = [], createdAt, updatedAt } = data;
    if (typeof taskId !== "string" || !taskId.trim()) {
      throw new Error("IngestTask.fromJSON: taskId is required");
    }
    assertKnownState(state, "IngestTask.fromJSON");
    if (!Array.isArray(steps)) {
      throw new Error("IngestTask.fromJSON: steps must be an array");
    }
    for (const entry of steps) {
      if (entry === null || typeof entry !== "object" || typeof entry.step !== "string") {
        throw new Error("IngestTask.fromJSON: every step must be an object with a step name");
      }
    }
    for (const [field, value] of [["createdAt", createdAt], ["updatedAt", updatedAt]]) {
      if (value !== undefined && (typeof value !== "string" || Number.isNaN(Date.parse(value)))) {
        throw new Error(`IngestTask.fromJSON: ${field} must be an ISO timestamp`);
      }
    }

    const task = new IngestTask({ taskId, source, state });
    task.steps = steps.map((entry) => ({ ...entry }));
    if (createdAt !== undefined) task.createdAt = createdAt;
    if (updatedAt !== undefined) task.updatedAt = updatedAt;
    return task;
  }

  toJSON() {
    return {
      taskId: this.taskId,
      state: this.#state,
      source: this.source,
      steps: this.steps,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}
