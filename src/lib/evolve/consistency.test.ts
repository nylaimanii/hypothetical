import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { classify, testDeps } from './consistency'

const root = path.resolve(__dirname, '..', '..', '..')
const reportTest = path.join(root, 'tests', 'consistency', 'report', 'report.test.ts')
const versions = new Map<string, string | null>([['g3-old-s1', '5.10.7'], ['g4-new-s1', '5.10.9'], ['g3-old-s1-life-1', '5.10.7']])
const base = { codeRoot: root, current: ['5.10.9'], versions }

test('a test reads the files it imports, directly or not', () => {
  const d = testDeps(root, reportTest)
  assert.ok(d.has('tests/consistency/report/report.test.ts'))
  assert.ok(d.has('src/lib/evolve/report.ts'))
  assert.ok(d.has('src/lib/evolve/facts.ts'), 'facts.ts comes in through report.ts')
})

test('a failure on older data is a warning, never a block', () => {
  const v = classify([{ name: 'the report on g3-old-s1 says the same final population', why: 'x', file: reportTest }], { ...base, changed: ['src/lib/evolve/report.ts'] })
  assert.equal(v.blocking.length, 0)
  assert.match(v.warnings[0].why2, /sim 5\.10\.7/)
})

test('a life counts as its world\'s sim version', () => {
  const v = classify([{ name: 'g3-old-s1-life-1 made the same choice', why: '', file: reportTest }], { ...base, changed: ['src/lib/evolve/report.ts'] })
  assert.equal(v.blocking.length, 0)
})

test('a failure in a test the commit does not touch is a warning', () => {
  const v = classify([{ name: 'the report on g4-new-s1 says x', why: '', file: reportTest }], { ...base, changed: ['src/lib/life/rules.ts'] })
  assert.equal(v.blocking.length, 0)
  assert.match(v.warnings[0].why2, /does not read any file this commit changes/)
})

test('a failure on current data in a test for a changed file blocks', () => {
  const v = classify([{ name: 'the report on g4-new-s1 says x', why: '', file: reportTest }], { ...base, changed: ['src/lib/evolve/facts.ts'] })
  assert.equal(v.blocking.length, 1)
})

test('a check of no data in a test for a changed file blocks, and so does a suite that could not run', () => {
  assert.equal(classify([{ name: 'clamps are said back', why: '', file: reportTest }], { ...base, changed: ['tests/consistency/report/report.test.ts'] }).blocking.length, 1)
  assert.equal(classify([{ name: 'the suite could run', why: 'syntax error' }], { ...base, changed: ['README.md'] }).blocking.length, 1)
})
