/**
 * inspect-pr-checks.mjs unit tests. Real disposable git repositories for
 * the git-root requirement; all `gh` interaction goes to a fake executable.
 */

import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { createFakeGh, initGitRepo, parseStdoutJson, runScript, SCRIPTS, tempDir } from './helpers.mjs'

function setup() {
  const tmp = tempDir('ipc')
  const repo = initGitRepo(tmp.dir).dir
  writeFileSync(join(repo, 'tracked.txt'), 'hello\n')
  return { tmp, repo }
}

function check(name, overrides = {}) {
  return {
    name,
    state: 'SUCCESS',
    conclusion: null,
    detailsUrl: 'https://github.com/acme/demo/actions/runs/101/job/202',
    startedAt: '2026-01-01T00:00:00Z',
    completedAt: '2026-01-01T00:01:00Z',
    ...overrides,
  }
}

test('no failing checks: exit 0 and an empty failingChecks list', () => {
  const { tmp, repo } = setup()
  try {
    const { script: gh } = createFakeGh(tmp.dir, {
      checks: { status: 0, stdout: JSON.stringify([check('unit'), check('lint', { state: 'SUCCESS' })]) },
    })
    const result = runScript(SCRIPTS.inspectPrChecks, ['--repo', repo, '--pr', '1', '--json', '--gh-bin', gh])
    assert.equal(result.status, 0, result.stderr)
    const out = parseStdoutJson(result)
    assert.equal(out.schemaVersion, 1)
    assert.equal(out.pr, '1')
    assert.deepEqual(out.failingChecks, [])
  } finally {
    tmp.clean()
  }
})

test('failed GitHub Actions check: run metadata + bounded log snippet + tail', () => {
  const { tmp, repo } = setup()
  try {
    const { script: gh } = createFakeGh(tmp.dir, {
      checks: {
        status: 0,
        stdout: JSON.stringify([check('test', { state: 'FAILURE', conclusion: 'failure' })]),
      },
      runView: {
        status: 0,
        stdout: JSON.stringify({
          conclusion: 'failure', status: 'completed', workflowName: 'CI',
          name: 'CI', event: 'pull_request', headBranch: 'feature/x',
          headSha: 'abcdef0123456789', url: 'https://github.com/acme/demo/actions/runs/101',
        }),
      },
      runLog: { status: 0, stdout: 'line1\nline2\nerror: tests failed in src/index.test.js\nline4\nline5\n' },
    })
    const result = runScript(SCRIPTS.inspectPrChecks, ['--repo', repo, '--pr', '1', '--json', '--max-lines', '20', '--context', '1', '--gh-bin', gh])
    assert.equal(result.status, 1, 'exit 1 signals remaining failures')
    const out = parseStdoutJson(result)
    assert.equal(out.failingChecks.length, 1)
    const f = out.failingChecks[0]
    assert.equal(f.name, 'test')
    assert.equal(f.provider, 'github-actions')
    assert.equal(f.runId, '101')
    assert.equal(f.jobId, '202')
    assert.equal(f.status, 'ok')
    assert.equal(f.run.workflowName, 'CI')
    assert.ok(f.logSnippet.includes('error: tests failed'), 'snippet must center on the failure marker')
    assert.ok(f.logTail.includes('line5'), 'tail must contain the last lines')
    assert.equal(f.error, null)
  } finally {
    tmp.clean()
  }
})

test('external CI provider: report-only, never log-diagnosed', () => {
  const { tmp, repo } = setup()
  try {
    const { script: gh } = createFakeGh(tmp.dir, {
      checks: {
        status: 0,
        stdout: JSON.stringify([check('buildkite/ci', {
          state: 'FAILURE',
          detailsUrl: 'https://buildkite.com/acme/demo/builds/99',
        })]),
      },
      // Deliberately no runView/runLog: the script must not call them.
    })
    const result = runScript(SCRIPTS.inspectPrChecks, ['--repo', repo, '--pr', '1', '--json', '--gh-bin', gh])
    assert.equal(result.status, 1)
    const out = parseStdoutJson(result)
    const f = out.failingChecks[0]
    assert.equal(f.provider, 'external')
    assert.equal(f.status, 'external')
    assert.equal(f.runId, null)
    assert.equal(f.logSnippet, '')
    assert.match(f.note, /No GitHub Actions run id/)
  } finally {
    tmp.clean()
  }
})

test('gh field drift: retries with the available fields reported by gh', () => {
  const { tmp, repo } = setup()
  try {
    const driftError = 'flag provided but not defined: -conclusion\nAvailable fields:\n  name\n  state\n  bucket\n  link\n  startedAt\n  completedAt\n  workflow\n'
    const { script: gh } = createFakeGh(tmp.dir, {
      // First call fails with drift, second call succeeds with the fallback
      // field set (bucket identifies the failure).
      checks: [
        { status: 1, stderr: driftError },
        { status: 0, stdout: JSON.stringify([check('test', { bucket: 'fail', detailsUrl: '' })]) },
      ],
    })
    const result = runScript(SCRIPTS.inspectPrChecks, ['--repo', repo, '--pr', '1', '--json', '--gh-bin', gh])
    assert.equal(result.status, 1, 'fallback check is failing (bucket fail)')
    const out = parseStdoutJson(result)
    assert.equal(out.failingChecks.length, 1)
    assert.equal(out.failingChecks[0].status, 'external', 'no detailsUrl on fallback fields → external')
  } finally {
    tmp.clean()
  }
})

test('pending run log: reported honestly as log_pending', () => {
  const { tmp, repo } = setup()
  try {
    const { script: gh } = createFakeGh(tmp.dir, {
      checks: { status: 0, stdout: JSON.stringify([check('test', { conclusion: 'failure' })]) },
      runView: { status: 0, stdout: JSON.stringify({ conclusion: null, status: 'in_progress' }) },
      runLog: { status: 1, stderr: 'gh: run log is still in progress; log will be available when it is complete\n' },
    })
    const result = runScript(SCRIPTS.inspectPrChecks, ['--repo', repo, '--pr', '1', '--json', '--gh-bin', gh])
    assert.equal(result.status, 1)
    const out = parseStdoutJson(result)
    const f = out.failingChecks[0]
    assert.equal(f.status, 'log_pending')
    assert.match(f.note, /still in progress/)
  } finally {
    tmp.clean()
  }
})

test('job-log fallback: pending run log falls back to the job log', () => {
  const { tmp, repo } = setup()
  try {
    const { script: gh } = createFakeGh(tmp.dir, {
      checks: { status: 0, stdout: JSON.stringify([check('test', { conclusion: 'failure' })]) },
      runView: { status: 0, stdout: JSON.stringify({ conclusion: 'failure', status: 'completed' }) },
      runLog: { status: 1, stderr: 'gh: run log is still in progress; log will be available when it is complete\n' },
      repoView: { status: 0, stdout: JSON.stringify({ nameWithOwner: 'acme/demo' }) },
      jobLog: { status: 0, stdout: 'job line 1\njob line 2\nError: assertion failed\n' },
    })
    const result = runScript(SCRIPTS.inspectPrChecks, ['--repo', repo, '--pr', '1', '--json', '--gh-bin', gh])
    assert.equal(result.status, 1)
    const out = parseStdoutJson(result)
    const f = out.failingChecks[0]
    assert.equal(f.status, 'ok')
    assert.ok(f.logSnippet.includes('assertion failed'), 'job log must be the snippet source')
  } finally {
    tmp.clean()
  }
})

test('unavailable logs: reported as log_unavailable without fabricating a reason', () => {
  const { tmp, repo } = setup()
  try {
    const { script: gh } = createFakeGh(tmp.dir, {
      checks: { status: 0, stdout: JSON.stringify([check('test', { conclusion: 'failure' })]) },
      runView: { status: 0, stdout: JSON.stringify({ conclusion: 'failure', status: 'completed' }) },
      runLog: { status: 1, stderr: 'gh: log not found for run 101\n' },
    })
    const result = runScript(SCRIPTS.inspectPrChecks, ['--repo', repo, '--pr', '1', '--json', '--gh-bin', gh])
    assert.equal(result.status, 1)
    const out = parseStdoutJson(result)
    const f = out.failingChecks[0]
    assert.equal(f.status, 'log_unavailable')
    assert.match(f.error, /log not found/)
    assert.equal(f.logSnippet, '')
  } finally {
    tmp.clean()
  }
})

test('failure snippet is bounded and centers on the latest failure marker', () => {
  const { tmp, repo } = setup()
  try {
    const lines = Array.from({ length: 60 }, (_, index) => `line ${index}`)
    lines[40] = 'FATAL: unhandled exception'
    const { script: gh } = createFakeGh(tmp.dir, {
      checks: { status: 0, stdout: JSON.stringify([check('test', { conclusion: 'failure' })]) },
      runView: { status: 0, stdout: JSON.stringify({}) },
      runLog: { status: 0, stdout: `${lines.join('\n')}\n` },
    })
    const result = runScript(SCRIPTS.inspectPrChecks, ['--repo', repo, '--pr', '1', '--json', '--max-lines', '10', '--context', '2', '--gh-bin', gh])
    assert.equal(result.status, 1)
    const out = parseStdoutJson(result)
    const snippet = out.failingChecks[0].logSnippet
    const snippetLines = snippet.split('\n')
    assert.ok(snippetLines.length <= 10, `snippet bounded by --max-lines (got ${snippetLines.length})`)
    assert.ok(snippet.includes('FATAL: unhandled exception'), 'snippet must include the failure marker')
    assert.ok(snippet.includes('line 38') && snippet.includes('line 41'), 'context window around the marker')
  } finally {
    tmp.clean()
  }
})

test('malformed checks JSON fails explicitly (exit 2)', () => {
  const { tmp, repo } = setup()
  try {
    const { script: gh } = createFakeGh(tmp.dir, {
      checks: { status: 0, stdout: 'not json' },
    })
    const result = runScript(SCRIPTS.inspectPrChecks, ['--repo', repo, '--pr', '1', '--json', '--gh-bin', gh])
    assert.equal(result.status, 2)
    assert.match(result.stderr, /failed to parse checks JSON/)
  } finally {
    tmp.clean()
  }
})

test('unexpected checks shape fails explicitly', () => {
  const { tmp, repo } = setup()
  try {
    const { script: gh } = createFakeGh(tmp.dir, {
      checks: { status: 0, stdout: '{"not":"an array"}' },
    })
    const result = runScript(SCRIPTS.inspectPrChecks, ['--repo', repo, '--pr', '1', '--json', '--gh-bin', gh])
    assert.equal(result.status, 2)
    assert.match(result.stderr, /unexpected checks JSON shape/)
  } finally {
    tmp.clean()
  }
})

test('current-branch PR resolution when no --pr is given', () => {
  const { tmp, repo } = setup()
  try {
    const { script: gh } = createFakeGh(tmp.dir, {
      prView: { status: 0, stdout: JSON.stringify({ number: 9 }) },
      checks: { status: 0, stdout: JSON.stringify([]) },
    })
    const result = runScript(SCRIPTS.inspectPrChecks, ['--repo', repo, '--json', '--gh-bin', gh])
    assert.equal(result.status, 0, result.stderr)
    const out = parseStdoutJson(result)
    assert.equal(out.pr, '9')
  } finally {
    tmp.clean()
  }
})

test('not a git repository: explicit blocker, exit 2', () => {
  const tmp = tempDir('ipc-nogit')
  try {
    const result = runScript(SCRIPTS.inspectPrChecks, ['--repo', tmp.dir, '--json'])
    assert.equal(result.status, 2)
    assert.match(result.stderr, /not inside a git repository/)
  } finally {
    tmp.clean()
  }
})

test('gh not authenticated: explicit blocker before any checks call', () => {
  const { tmp, repo } = setup()
  try {
    const { script: gh } = createFakeGh(tmp.dir, {
      auth: { status: 1, stderr: 'gh: not logged in\n' },
    })
    const result = runScript(SCRIPTS.inspectPrChecks, ['--repo', repo, '--pr', '1', '--json', '--gh-bin', gh])
    assert.equal(result.status, 2)
    assert.match(result.stderr, /not logged in/)
  } finally {
    tmp.clean()
  }
})
