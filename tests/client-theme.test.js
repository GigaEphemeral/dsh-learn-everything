// Unit tests for the client theme helper (S4 R1). DSH signals dark mode with
// the dark-only body attribute; the panel and the graph iframe both derive
// their theme from this mapping, so a regression here would repaint the panel
// with the wrong theme.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isDarkDocument, graphPageTheme } from '../src/client/theme.js'

function fakeBody(attributes) {
  return {
    hasAttribute(name) { return attributes.includes(name) },
  }
}

test('isDarkDocument follows the dark-only body attribute', () => {
  assert.equal(isDarkDocument(fakeBody(['data-ds-dark-theme'])), true)
  assert.equal(isDarkDocument(fakeBody([])), false)
  assert.equal(isDarkDocument(fakeBody(['data-other'])), false)
})

test('isDarkDocument tolerates a missing or odd body', () => {
  assert.equal(isDarkDocument(null), false)
  assert.equal(isDarkDocument(undefined), false)
  assert.equal(isDarkDocument({}), false)
  assert.equal(isDarkDocument('body'), false)
})

test('graphPageTheme maps the dark flag to the graph page theme', () => {
  assert.equal(graphPageTheme(true), 'dark')
  assert.equal(graphPageTheme(false), 'light')
  assert.equal(graphPageTheme(undefined), 'light')
})
