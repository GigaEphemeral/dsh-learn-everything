// Native DSH tools for daily practice (environment fix). The agent calls these
// tools instead of hunting for external CLI scripts: the HOST process executes
// them, so the SQLite WAL sidecar writes never hit the agent's sandbox.
//
// Definitions are plain ToolDefinition objects (name, JSON-Schema parameters,
// output { schema, render }, execute). `@deepseek-ai/dsh-tools` belongs to the
// DSH runtime and is not installable into a profile, so the plugin builds
// registry-ready definitions itself instead of importing defineTool.

import { join } from 'node:path'
import { LearningDb } from '../../lib/src/db/client.js'
import { PracticeSession } from '../../lib/src/learning/practice.js'
import { QuestionStore } from '../../lib/src/learning/questions.js'
import { AttemptStore } from '../../lib/src/learning/attempts.js'
import { ReviewStore } from '../../lib/src/learning/review.js'
import { MasteryStore } from '../../lib/src/learning/mastery.js'
import { resolveStateDir } from '../ingest/state-dir.js'
import { ObsidianClient, ObsidianAdapter } from '../obsidian/obsidian-adapter.js'
import { contextNode } from '../../scripts/wiki-node-cli.mjs'

const JSON_OUTPUT = {
  schema: { type: 'object' },
  render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
}

function dbPath() {
  return process.env.OBSIDIAN_LEARNING_DB ?? join(resolveStateDir(import.meta.url), 'learning.db')
}

function openDb() {
  return new LearningDb(dbPath())
}

function resolveObsidian({ getConfig }) {
  const cfg = typeof getConfig === 'function' ? (getConfig() ?? {}) : {}
  const apiKey = (typeof cfg.apiKey === 'string' ? cfg.apiKey : process.env.OBSIDIAN_API_KEY || '').trim()
  const baseUrl = (typeof cfg.baseUrl === 'string' && cfg.baseUrl.trim())
    || process.env.OBSIDIAN_BASE_URL || 'https://127.0.0.1:27124'
  return { apiKey, baseUrl }
}

// The registry sends required fields to the model but does not validate them
// for hand-built definitions, so each tool rejects an incomplete call before
// touching the database.
function assertArgs(toolName, args, required, checks = {}) {
  for (const key of required) {
    const value = args?.[key]
    if (value === undefined || value === null || value === '') {
      throw new Error(`${toolName}: missing required argument "${key}"`)
    }
  }
  for (const [key, check] of Object.entries(checks)) {
    const value = args?.[key]
    if (value !== undefined && !check(value)) {
      throw new Error(`${toolName}: invalid argument "${key}"`)
    }
  }
}

function drawNodeSpec({ getConfig }) {
  return {
    name: 'practice_draw_node',
    description: 'Draw one random wiki node with its content, source notes and learning status, for a daily-practice session.',
    parameters: { type: 'object', properties: {}, required: [] },
    output: JSON_OUTPUT,
    execute: async () => {
      const { apiKey, baseUrl } = resolveObsidian({ getConfig })
      if (!apiKey) return { error: 'obsidian-not-configured', message: 'No OBSIDIAN_API_KEY configured.' }
      const adapter = new ObsidianAdapter(new ObsidianClient({ baseUrl, apiKey }))
      const payload = await contextNode(adapter, 'random')
      return payload ?? { error: 'draw-failed', message: 'No wiki node could be drawn.' }
    },
  }
}

function recordQuestionSpec() {
  return {
    name: 'practice_record_question',
    description: 'Record a generated daily-practice question into the learning database (SQLite). Returns the recorded question id.',
    parameters: {
      type: 'object',
      properties: {
        questionId: { type: 'string', description: 'Stable question id (e.g. slug-v1).' },
        version: { type: 'integer', description: 'Question version; 1 for the first ask.' },
        type: { type: 'string', enum: ['concept', 'implementation', 'test'], description: 'Question type.' },
        topic: { type: 'string', description: 'Wiki concept/topic the question covers.' },
        prompt: { type: 'string', description: 'The question prompt text.' },
        reference: { type: 'string', description: 'Optional reference note path.' },
      },
      required: ['questionId', 'version', 'type', 'topic', 'prompt'],
    },
    output: JSON_OUTPUT,
    execute: async (args) => {
      assertArgs('practice_record_question', args, ['questionId', 'version', 'type', 'topic', 'prompt'], {
        version: (value) => Number.isInteger(value) && value > 0,
        type: (value) => ['concept', 'implementation', 'test'].includes(value),
      })
      const ldb = openDb()
      try {
        new PracticeSession(ldb).startQuestion({
          questionId: args.questionId,
          version: args.version,
          type: args.type,
          topic: args.topic,
          prompt: args.prompt,
          reference: args.reference ?? null,
        })
        return { recorded: true, questionId: args.questionId }
      } finally { ldb.close() }
    },
  }
}

function recordAnswerSpec() {
  return {
    name: 'practice_record_answer',
    description: 'Record one answer with its rating and review update into the learning database (SQLite). Returns the answer id.',
    parameters: {
      type: 'object',
      properties: {
        questionId: { type: 'string', description: 'Id of the question being answered.' },
        questionVersion: { type: 'integer', description: 'Version of the question being answered.' },
        result: { type: 'string', enum: ['correct', 'incorrect', 'partial'], description: 'Answer outcome.' },
        correct: { type: 'boolean', description: 'Whether the answer is factually correct.' },
        score: { type: 'number', description: '0-100 score, or null.' },
        phase: { type: 'string', enum: ['first', 'correction', 'variant'], description: 'Answer phase.' },
        concepts: { type: 'array', items: { type: 'string' }, description: 'Concept names exercised by the answer.' },
        feedback: { type: 'string', description: 'Grading feedback text.' },
      },
      required: ['questionId', 'questionVersion', 'result', 'correct', 'phase'],
    },
    output: JSON_OUTPUT,
    execute: async (args) => {
      assertArgs('practice_record_answer', args, ['questionId', 'questionVersion', 'result', 'correct', 'phase'], {
        questionVersion: (value) => Number.isInteger(value) && value > 0,
        result: (value) => ['correct', 'incorrect', 'partial'].includes(value),
        phase: (value) => ['first', 'correction', 'variant'].includes(value),
      })
      const ldb = openDb()
      try {
        const id = new PracticeSession(ldb).recordAnswer({
          questionId: args.questionId,
          questionVersion: args.questionVersion,
          result: args.result,
          correct: args.correct,
          score: args.score ?? null,
          phase: args.phase,
          concepts: args.concepts ?? [],
          feedback: args.feedback ?? null,
        })
        return { answerId: id }
      } finally { ldb.close() }
    },
  }
}

function statusSpec() {
  return {
    name: 'practice_status',
    description: 'Show one question with its review schedule, recent attempts and mastery levels from the learning database.',
    parameters: {
      type: 'object',
      properties: {
        questionId: { type: 'string', description: 'Question id to inspect.' },
      },
      required: ['questionId'],
    },
    output: JSON_OUTPUT,
    execute: async (args) => {
      assertArgs('practice_status', args, ['questionId'])
      const ldb = openDb()
      try {
        const qid = args.questionId
        const question = new QuestionStore(ldb).get(qid)
        const review = new ReviewStore(ldb).get(qid)
        const attempts = new AttemptStore(ldb).recentFor(qid, 50)
        let mastery = []
        if (question) {
          const concept = ldb.db.prepare('SELECT id FROM concepts WHERE name = ?').get(question.topic)
          if (concept) mastery = new MasteryStore(ldb).recentLevels(concept.id, 5)
        }
        return { question: question ?? null, review: review ?? null, attempts, mastery }
      } finally { ldb.close() }
    },
  }
}

/** All practice tools as registry-ready ToolDefinition objects. */
export function practiceToolSpecs({ getConfig } = {}) {
  return [drawNodeSpec({ getConfig }), recordQuestionSpec(), recordAnswerSpec(), statusSpec()]
}

// Register the practice tools on the host tool registry. Returns the
// registration disposers; an empty list when the host has no tools service
// (direct unit-test callers). A definition rejected by the registry is
// reported and skipped so a tool problem cannot take the skill catalog down.
export function registerPracticeTools(ctx, { getConfig } = {}) {
  if (typeof ctx?.tools?.register !== 'function') return []
  const disposers = []
  for (const spec of practiceToolSpecs({ getConfig })) {
    try {
      disposers.push(ctx.tools.register(spec))
    } catch (error) {
      console.warn(`[dsh-learn-everything] practice tool ${spec.name} not registered: ${error?.message}`)
    }
  }
  return disposers
}
