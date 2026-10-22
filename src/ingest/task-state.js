// Task state machine for ingest (P3), persisted as JSON so a run can be
// resumed after interruption. States follow the plan: pending -> preflighted
// -> awaiting_confirmation -> planned -> awaiting_write_confirmation ->
// writing -> validating -> compiling -> completed, plus failed/needs_review/
// cancelled/partial.

export const TASK_STATES = [
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
];

export class IngestTask {
  constructor({ taskId, source, state = "pending" }) {
    if (!taskId) throw new Error("IngestTask: taskId is required");
    this.taskId = taskId;
    this.source = source;
    this.state = state;
    this.steps = [];
    this.createdAt = new Date().toISOString();
    this.updatedAt = this.createdAt;
  }

  transition(nextState) {
    if (!TASK_STATES.includes(nextState)) {
      throw new Error(`unknown task state "${nextState}"`);
    }
    this.state = nextState;
    this.updatedAt = new Date().toISOString();
    return this;
  }

  log(step, detail) {
    this.steps.push({ step, detail, at: new Date().toISOString() });
    this.updatedAt = new Date().toISOString();
    return this;
  }

  toJSON() {
    return {
      taskId: this.taskId,
      state: this.state,
      source: this.source,
      steps: this.steps,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}
