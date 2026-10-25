// Native DSH tools for daily practice (environment fix). The agent calls these
// tools instead of hunting for external CLI scripts: the HOST process executes
// them, so the SQLite WAL sidecar writes never hit the agent's sandbox.

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

function drawNodeSpec({ getConfig }) {
  return {
    name: 'practice_draw_node',
    description: 'Draw one random wiki node with its content, source notes and learning status, for a daily-practice session.',
    parameters: {},
    output: { schema: { type: 'object' } },
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
      questionId: { type: 'string', required: true, description: 'Stable question id (e.g. slug-v1).' },
      version: { type: 'integer', required: true, description: 'Question version; 1 for the first ask.' },
      type: { type: 'string', required: true, description: 'concept | implementation | test' },
      topic: { type: 'string', required: true, description: 'Wiki concept/topic the question covers.' },
      prompt: { type: 'string', required: true, description: 'The question prompt text.' },
      reference: { type: 'string', description: 'Optional reference note path.' },
    },
    output: { schema: { type: 'object', additionalProperties: false, properties: {
      recorded: { type: 'boolean', required: true }, questionId: { type: 'string', required: true },
    } } },
    execute: async (args) => {
      const ldb = openDb()
      try {
        new PracticeSession(ldb).startQuestion({ ...args, reference: args.reference ?? null })
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
      questionId: { type: 'string', required: true, description: 'Id of the question being answered.' },
      questionVersion: { type: 'integer', required: true, description: 'Version of the question being answered.' },
      result: { type: 'string', required: true, description: 'correct | incorrect | partial' },
      correct: { type: 'boolean', required: true, description: 'Whether the answer is factually correct.' },
      score: { type: 'number', description: '0-100 score, or null.' },
      phase: { type: 'string', required: true, description: 'first | correction | variant' },
      concepts: { type: 'array', description: 'Concept names exercised by the answer.', items: { type: 'string' } },
      feedback: { type: 'string', description: 'Grading feedback text.' },
    },
    output: { schema: { type: 'object', additionalProperties: false, properties: {
      answerId: { type: 'string', required: true },
    } } },
    execute: async (args) => {
      const ldb = openDb()
      try {
        const id = new PracticeSession(ldb).recordAnswer({
          ...args,
          score: args.score ?? null,
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
      questionId: { type: 'string', required: true, description: 'Question id to inspect.' },
    },
    output: { schema: { type: 'object' } },
    execute: async (args) => {
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

/** All practice tool specs as plain objects (the host wraps them with defineTool). */
export function practiceToolSpecs({ getConfig } = {}) {
  return [drawNodeSpec({ getConfig }), recordQuestionSpec(), recordAnswerSpec(), statusSpec()]
}

// Register the practice tools. The host provides defineTool; callers without a
// host package (unit tests) omit it and register the plain specs. Returns the
// registration disposers; an empty list when the host has no tools service.
export function registerPracticeTools(ctx, { defineTool, getConfig } = {}) {
  if (typeof ctx?.tools?.register !== 'function') return []
  const wrap = typeof defineTool === 'function' ? defineTool : (spec) => spec
  return practiceToolSpecs({ getConfig }).map((spec) => ctx.tools.register(wrap(spec)))
}
