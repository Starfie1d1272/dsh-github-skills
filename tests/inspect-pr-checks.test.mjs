/**
 * inspect-pr-checks.mjs unit tests. Real disposable git repositories for
 * the git-root requirement; all `gh` interaction goes to a protocol-aware
 * fake executable that verifies the repo binding (`-R`) and fails loudly on
 * unexpected invocations.
 */

import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { createFakeGh, initGitRepo, parseStdoutJson, runScript, SCRIPTS, tempDir } from './helpers.mjs'

/** Real disposable repo with an origin remote pointing at acme/demo. */
function setup(repoSlug = 'acme/demo', host = 'github.com') {
  const tmp = tempDir('ipc')
  const repo = initGitRepo(tmp.dir)
  writeFileSync(join(repo.dir, 'tracked.txt'), 'hello\n')
  repo.run(['add', '-A'])
  repo.run(['commit', '-m', 'init'])
  repo.run(['remote', 'add', 'origin', `https://${host}/${repoSlug}.git`])
  return { tmp, repo: repo.dir, log: join(tmp.dir, '.invocations.log') }
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

function runChecks(tmp, repo, gh, extraArgs = []) {
  return runScript(SCRIPTS.inspectPrChecks, ['--repo', repo, '--pr', '1', '--json', '--gh-bin', gh, ...extraArgs])
}

function readInvocationLog(log) {
  return readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
}

test('no failing checks: exit 0 and an empty failingChecks list, checks bound to repo', () => {
  const { tmp, repo, log } = setup()
  try {
    const { script: gh } = createFakeGh(tmp.dir, {
      expectedRepo: 'github.com/acme/demo',
      repoView: { status: 0, stdout: JSON.stringify({ nameWithOwner: 'acme/demo' }) },
      checks: { status: 0, stdout: JSON.stringify([check('unit'), check('lint', { state: 'SUCCESS' })]) },
    })
    const result = runChecks(tmp, repo, gh)
    assert.equal(result.status, 0, result.stderr)
    const out = parseStdoutJson(result)
    assert.equal(out.schemaVersion, 1)
    assert.equal(out.pr, '1')
    assert.equal(out.repoSlug, 'acme/demo')
    assert.deepEqual(out.failingChecks, [])
    const checksCall = readInvocationLog(log).find((argv) => argv[0] === 'pr' && argv[1] === 'checks')
    assert.ok(checksCall.join(' ').includes('-R github.com/acme/demo'), 'checks must carry -R acme/demo')
  } finally {
    tmp.clean()
  }
})

test('failed GitHub Actions check: run metadata + bounded log snippet + tail, run APIs bound to repo', () => {
  const { tmp, repo, log } = setup()
  try {
    const { script: gh } = createFakeGh(tmp.dir, {
      expectedRepo: 'github.com/acme/demo',
      checks: { status: 0, stdout: JSON.stringify([check('test', { state: 'FAILURE', conclusion: 'failure' })]) },
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
    const result = runChecks(tmp, repo, gh, ['--max-lines', '20', '--context', '1'])
    assert.equal(result.status, 1, 'exit 1 signals remaining failures')
    const out = parseStdoutJson(result)
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
    const calls = readInvocationLog(log)
    for (const argv of calls) {
      if (argv[0] === 'run') {
        assert.ok(argv.join(' ').includes('-R github.com/acme/demo'), `run call must bind repo: ${argv.join(' ')}`)
      }
    }
  } finally {
    tmp.clean()
  }
})

test('external CI provider (buildkite): report-only, never log-diagnosed, still repo-bound checks', () => {
  const { tmp, repo, log } = setup()
  try {
    const { script: gh } = createFakeGh(tmp.dir, {
      expectedRepo: 'github.com/acme/demo',
      checks: {
        status: 0,
        stdout: JSON.stringify([check('buildkite/ci', {
          state: 'FAILURE',
          detailsUrl: 'https://buildkite.com/acme/demo/builds/99',
        })]),
      },
      // Deliberately no runView/runLog/repoView/jobLog scenarios.
    })
    const result = runChecks(tmp, repo, gh)
    assert.equal(result.status, 1)
    const out = parseStdoutJson(result)
    const f = out.failingChecks[0]
    assert.equal(f.provider, 'external')
    assert.equal(f.status, 'external')
    assert.equal(f.runId, null)
    assert.equal(f.logSnippet, '')
    assert.match(f.note, /No GitHub Actions run id/)
    const calls = readInvocationLog(log)
    assert.ok(!calls.some((argv) => argv[0] === 'run'), 'run surface must never be called for external CI')
    assert.ok(!calls.some((argv) => argv[0] === 'api'), 'Actions job-log API must never be called for external CI')
  } finally {
    tmp.clean()
  }
})

test('adversarial: generic /runs/123 URL is external, not GitHub Actions', () => {
  const { tmp, repo, log } = setup()
  try {
    const { script: gh } = createFakeGh(tmp.dir, {
      expectedRepo: 'github.com/acme/demo',
      checks: {
        status: 0,
        stdout: JSON.stringify([check('self-hosted', {
          state: 'FAILURE',
          detailsUrl: 'https://ci.example.com/project/runs/123',
        })]),
      },
    })
    const result = runChecks(tmp, repo, gh)
    assert.equal(result.status, 1)
    const out = parseStdoutJson(result)
    const f = out.failingChecks[0]
    assert.equal(f.provider, 'external', '/runs/123 must not be treated as Actions')
    assert.equal(f.status, 'external')
    assert.equal(f.runId, null)
    assert.equal(f.logSnippet, '')
    const calls = readInvocationLog(log)
    assert.ok(!calls.some((argv) => argv[0] === 'run'), 'no gh run for a generic /runs/ URL')
  } finally {
    tmp.clean()
  }
})

test('adversarial: CircleCI pipeline URL is external', () => {
  const { tmp, repo } = setup()
  try {
    const { script: gh } = createFakeGh(tmp.dir, {
      expectedRepo: 'github.com/acme/demo',
      checks: {
        status: 0,
        stdout: JSON.stringify([check('circleci', {
          state: 'FAILURE',
          detailsUrl: 'https://app.circleci.com/pipelines/acme/1/workflows/2',
        })]),
      },
    })
    const result = runChecks(tmp, repo, gh)
    assert.equal(result.status, 1)
    const f = parseStdoutJson(result).failingChecks[0]
    assert.equal(f.provider, 'external')
    assert.equal(f.status, 'external')
  } finally {
    tmp.clean()
  }
})

test('GHES target + matching GHES Actions URL is GitHub Actions, bound to the GHES host', () => {
  const { tmp, repo, log } = setup('acme/demo', 'ghes.internal')
  try {
    const { script: gh } = createFakeGh(tmp.dir, {
      expectedHost: 'ghes.internal',
      expectedRepo: 'ghes.internal/acme/demo',
      checks: {
        status: 0,
        stdout: JSON.stringify([check('ghes-test', {
          state: 'FAILURE',
          detailsUrl: 'https://ghes.internal/acme/demo/actions/runs/202/job/303',
        })]),
      },
      runView: { status: 0, stdout: JSON.stringify({ conclusion: 'failure', status: 'completed' }) },
      runLog: { status: 0, stdout: 'error: ghes failure\n' },
    })
    const result = runChecks(tmp, repo, gh)
    assert.equal(result.status, 1)
    const out = parseStdoutJson(result)
    const f = out.failingChecks[0]
    assert.equal(f.provider, 'github-actions')
    assert.equal(f.runId, '202')
    assert.equal(f.jobId, '303')
    assert.equal(out.host, 'ghes.internal')
    for (const argv of readInvocationLog(log)) {
      if (argv[0] === 'run' || argv[0] === 'pr') {
        assert.ok(argv.join(' ').includes('-R ghes.internal/acme/demo'), `run/checks bound to GHES selector: ${argv.join(' ')}`)
      }
    }
  } finally {
    tmp.clean()
  }
})

test('adversarial: /actions/runs path on a non-target host is external (never log-diagnosed)', () => {
  const { tmp, repo, log } = setup()
  try {
    const { script: gh } = createFakeGh(tmp.dir, {
      expectedRepo: 'github.com/acme/demo',
      checks: {
        status: 0,
        stdout: JSON.stringify([
          check('ci.example', { state: 'FAILURE', detailsUrl: 'https://ci.example.com/actions/runs/123' }),
          check('evil', { state: 'FAILURE', detailsUrl: 'https://evil.example/actions/runs/123' }),
        ]),
      },
    })
    const result = runChecks(tmp, repo, gh)
    assert.equal(result.status, 1)
    const out = parseStdoutJson(result)
    for (const f of out.failingChecks) {
      assert.equal(f.provider, 'external', `${f.detailsUrl} must be external`)
      assert.equal(f.status, 'external')
      assert.equal(f.runId, null)
      assert.equal(f.logSnippet, '')
    }
    const calls = readInvocationLog(log)
    assert.ok(!calls.some((argv) => argv[0] === 'run'), 'no gh run for a host-mismatched /actions/runs URL')
    assert.ok(!calls.some((argv) => argv[0] === 'api'), 'no Actions job-log API for host-mismatched URLs')
  } finally {
    tmp.clean()
  }
})

test('GHES target + github.com Actions URL is external (host mismatch)', () => {
  const { tmp, repo, log } = setup('acme/demo', 'ghes.internal')
  try {
    const { script: gh } = createFakeGh(tmp.dir, {
      expectedHost: 'ghes.internal',
      expectedRepo: 'ghes.internal/acme/demo',
      checks: {
        status: 0,
        stdout: JSON.stringify([check('gh-com', {
          state: 'FAILURE',
          detailsUrl: 'https://github.com/acme/demo/actions/runs/999',
        })]),
      },
    })
    const result = runChecks(tmp, repo, gh)
    assert.equal(result.status, 1)
    const f = parseStdoutJson(result).failingChecks[0]
    assert.equal(f.provider, 'external', 'github.com Actions URL must not count for a GHES target')
    assert.equal(f.runId, null)
    const calls = readInvocationLog(log)
    assert.ok(!calls.some((argv) => argv[0] === 'run'), 'no gh run across hosts')
  } finally {
    tmp.clean()
  }
})

test('gh field drift: retries with the available fields reported by gh', () => {
  const { tmp, repo } = setup()
  try {
    const driftError = 'flag provided but not defined: -conclusion\nAvailable fields:\n  name\n  state\n  bucket\n  link\n  startedAt\n  completedAt\n  workflow\n'
    const { script: gh } = createFakeGh(tmp.dir, {
      expectedRepo: 'github.com/acme/demo',
      checks: [
        { status: 1, stderr: driftError },
        { status: 0, stdout: JSON.stringify([check('test', { bucket: 'fail', detailsUrl: '' })]) },
      ],
    })
    const result = runChecks(tmp, repo, gh)
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
      expectedRepo: 'github.com/acme/demo',
      checks: { status: 0, stdout: JSON.stringify([check('test', { conclusion: 'failure' })]) },
      runView: { status: 0, stdout: JSON.stringify({ conclusion: null, status: 'in_progress' }) },
      runLog: { status: 1, stderr: 'gh: run log is still in progress; log will be available when it is complete\n' },
      jobLog: { status: 1, stderr: 'gh: job log is still in progress; log will be available when it is complete\n' },
    })
    const result = runChecks(tmp, repo, gh)
    assert.equal(result.status, 1)
    const f = parseStdoutJson(result).failingChecks[0]
    assert.equal(f.status, 'log_pending')
    assert.match(f.note, /still in progress/)
  } finally {
    tmp.clean()
  }
})

test('job-log fallback: pending run log falls back to the job log bound to the target repo', () => {
  const { tmp, repo, log } = setup()
  try {
    const { script: gh } = createFakeGh(tmp.dir, {
      expectedRepo: 'github.com/acme/demo',
      checks: { status: 0, stdout: JSON.stringify([check('test', { conclusion: 'failure' })]) },
      runView: { status: 0, stdout: JSON.stringify({ conclusion: 'failure', status: 'completed' }) },
      runLog: { status: 1, stderr: 'gh: run log is still in progress; log will be available when it is complete\n' },
      jobLog: { status: 0, stdout: 'job line 1\njob line 2\nError: assertion failed\n' },
    })
    const result = runChecks(tmp, repo, gh)
    assert.equal(result.status, 1)
    const out = parseStdoutJson(result)
    const f = out.failingChecks[0]
    assert.equal(f.status, 'ok')
    assert.ok(f.logSnippet.includes('assertion failed'), 'job log must be the snippet source')
    const apiCall = readInvocationLog(log).find((argv) => argv[0] === 'api')
    const endpoint = apiCall?.find((a) => a.startsWith('/'))
    assert.ok(apiCall !== undefined && endpoint === '/repos/acme/demo/actions/jobs/202/logs', `job log endpoint must target acme/demo: ${apiCall?.join(' ')}`)
    assert.ok(apiCall?.join(' ').includes('--hostname github.com'), 'job log API must bind github.com')
  } finally {
    tmp.clean()
  }
})

test('unavailable logs: reported as log_unavailable without fabricating a reason', () => {
  const { tmp, repo } = setup()
  try {
    const { script: gh } = createFakeGh(tmp.dir, {
      expectedRepo: 'github.com/acme/demo',
      checks: { status: 0, stdout: JSON.stringify([check('test', { conclusion: 'failure' })]) },
      runView: { status: 0, stdout: JSON.stringify({ conclusion: 'failure', status: 'completed' }) },
      runLog: { status: 1, stderr: 'gh: log not found for run 101\n' },
    })
    const result = runChecks(tmp, repo, gh)
    assert.equal(result.status, 1)
    const f = parseStdoutJson(result).failingChecks[0]
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
      expectedRepo: 'github.com/acme/demo',
      checks: { status: 0, stdout: JSON.stringify([check('test', { conclusion: 'failure' })]) },
      runView: { status: 0, stdout: JSON.stringify({}) },
      runLog: { status: 0, stdout: `${lines.join('\n')}\n` },
    })
    const result = runChecks(tmp, repo, gh, ['--max-lines', '10', '--context', '2'])
    assert.equal(result.status, 1)
    const snippet = parseStdoutJson(result).failingChecks[0].logSnippet
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
      expectedRepo: 'github.com/acme/demo',
      checks: { status: 0, stdout: 'not json' },
    })
    const result = runChecks(tmp, repo, gh)
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
      expectedRepo: 'github.com/acme/demo',
      checks: { status: 0, stdout: '{"not":"an array"}' },
    })
    const result = runChecks(tmp, repo, gh)
    assert.equal(result.status, 2)
    assert.match(result.stderr, /unexpected checks JSON shape/)
  } finally {
    tmp.clean()
  }
})

test('current-branch PR resolution uses the canonical URL repo (cross-repo aware)', () => {
  const { tmp, repo, log } = setup()
  try {
    const { script: gh } = createFakeGh(tmp.dir, {
      expectedRepo: 'github.com/acme/demo',
      prView: { status: 0, stdout: JSON.stringify({ number: 9, url: 'https://github.com/acme/demo/pull/9' }) },
      checks: { status: 0, stdout: JSON.stringify([]) },
    })
    const result = runScript(SCRIPTS.inspectPrChecks, ['--repo', repo, '--json', '--gh-bin', gh])
    assert.equal(result.status, 0, result.stderr)
    const out = parseStdoutJson(result)
    assert.equal(out.pr, '9')
    assert.equal(out.repoSlug, 'acme/demo')
    const checksCall = readInvocationLog(log).find((argv) => argv[0] === 'pr' && argv[1] === 'checks')
    assert.ok(checksCall.join(' ').includes('-R github.com/acme/demo'), 'checks bound to the PR target repo')
  } finally {
    tmp.clean()
  }
})

test('cross-repo: local checkout A + PR URL for repo B binds every query to B', () => {
  const { tmp, repo, log } = setup('acme/local-a')
  try {
    const prUrl = 'https://github.com/acme/remote-b/pull/123'
    const { script: gh } = createFakeGh(tmp.dir, {
      expectedRepo: 'github.com/acme/remote-b',
      checks: {
        status: 0,
        stdout: JSON.stringify([{
          name: 'ci', state: 'FAILURE', conclusion: 'failure',
          detailsUrl: 'https://github.com/acme/remote-b/actions/runs/555/job/666',
        }]),
      },
      runView: { status: 0, stdout: JSON.stringify({ conclusion: 'failure', status: 'completed' }) },
      runLog: { status: 1, stderr: 'gh: run log is still in progress; log will be available when it is complete\n' },
      jobLog: { status: 0, stdout: 'Error: cross-repo failure\n' },
    })
    const result = runScript(SCRIPTS.inspectPrChecks, ['--repo', repo, '--pr', prUrl, '--json', '--gh-bin', gh])
    assert.equal(result.status, 1, result.stderr)
    const out = parseStdoutJson(result)
    assert.equal(out.repoSlug, 'acme/remote-b', 'target context must be repo B')
    assert.equal(out.failingChecks[0].runId, '555')
    const calls = readInvocationLog(log)
    const checksCall = calls.find((argv) => argv[0] === 'pr' && argv[1] === 'checks')
    assert.ok(checksCall.join(' ').includes('-R github.com/acme/remote-b'), 'checks bound to repo B')
    const runCall = calls.find((argv) => argv[0] === 'run')
    assert.ok(runCall.join(' ').includes('-R github.com/acme/remote-b'), 'run view bound to repo B')
    const apiCall = calls.find((argv) => argv[0] === 'api')
    const endpoint = apiCall.find((a) => a.startsWith('/'))
    assert.ok(endpoint === '/repos/acme/remote-b/actions/jobs/666/logs', `job log must target repo B: ${apiCall.join(' ')}`)
    assert.ok(apiCall.join(' ').includes('--hostname github.com'), 'job log must bind github.com')
    assert.ok(!calls.some((argv) => argv.join(' ').includes('local-a')), 'no query may touch the local repo A')
  } finally {
    tmp.clean()
  }
})

test('cross-repo GHES: local github.com repo A + GHES PR URL B binds everything to the GHES host', () => {
  const { tmp, repo, log } = setup('acme/local-a')
  try {
    const prUrl = 'https://ghes.example.com/acme/remote-b/pull/321'
    const { script: gh } = createFakeGh(tmp.dir, {
      expectedHost: 'ghes.example.com',
      expectedRepo: 'ghes.example.com/acme/remote-b',
      checks: {
        status: 0,
        stdout: JSON.stringify([{
          name: 'ci', state: 'FAILURE', conclusion: 'failure',
          detailsUrl: 'https://ghes.example.com/acme/remote-b/actions/runs/777/job/888',
        }]),
      },
      runView: { status: 0, stdout: JSON.stringify({ conclusion: 'failure', status: 'completed' }) },
      runLog: { status: 1, stderr: 'gh: run log is still in progress; log will be available when it is complete\n' },
      jobLog: { status: 0, stdout: 'Error: ghes cross-repo failure\n' },
    })
    const result = runScript(SCRIPTS.inspectPrChecks, ['--repo', repo, '--pr', prUrl, '--json', '--gh-bin', gh])
    assert.equal(result.status, 1, result.stderr)
    const out = parseStdoutJson(result)
    assert.equal(out.host, 'ghes.example.com')
    assert.equal(out.repoSlug, 'acme/remote-b')
    assert.equal(out.failingChecks[0].runId, '777')
    const calls = readInvocationLog(log)
    const checksCall = calls.find((argv) => argv[0] === 'pr' && argv[1] === 'checks')
    assert.ok(checksCall.join(' ').includes('-R ghes.example.com/acme/remote-b'), 'checks bound to GHES repo B')
    const runCall = calls.find((argv) => argv[0] === 'run')
    assert.ok(runCall.join(' ').includes('-R ghes.example.com/acme/remote-b'), 'run view bound to GHES repo B')
    const apiCall = calls.find((argv) => argv[0] === 'api')
    assert.ok(apiCall.join(' ').includes('--hostname ghes.example.com'), 'job log API bound to the GHES host')
    assert.ok(apiCall.find((a) => a.startsWith('/')) === '/repos/acme/remote-b/actions/jobs/888/logs', 'job log endpoint on the GHES repo')
    assert.ok(!calls.some((argv) => argv.join(' ').includes('github.com')), 'no call may fall back to github.com')
    assert.ok(!calls.some((argv) => argv.join(' ').includes('local-a')), 'no call may touch the local repo A')
  } finally {
    tmp.clean()
  }
})

test('boundary redaction: invalid --pr carrying a token never reaches stderr raw', () => {
  const { tmp, repo } = setup()
  try {
    const { script: gh } = createFakeGh(tmp.dir, {})
    const result = runScript(SCRIPTS.inspectPrChecks, ['--repo', repo, '--pr', 'ghp_ABCDEFGHIJKLMNOPQRST', '--json', '--gh-bin', gh])
    assert.equal(result.status, 2)
    assert.ok(!result.stderr.includes('ghp_ABCDEFGHIJKLMNOPQRST'), 'raw token must not appear in stderr')
    assert.ok(result.stderr.includes('[REDACTED_GITHUB_TOKEN]'), 'redacted placeholder in the diagnostic')
  } finally {
    tmp.clean()
  }
})

test('boundary redaction: unknown arg carrying a token never reaches stderr raw', () => {
  const { tmp, repo } = setup()
  try {
    const { script: gh } = createFakeGh(tmp.dir, {})
    // The token rides the unknown flag itself.
    const result = runScript(SCRIPTS.inspectPrChecks, ['--repo', repo, '--github_pat_ABCDEFGHIJKLMNOPQRST_123', '--gh-bin', gh])
    assert.equal(result.status, 2)
    assert.ok(!result.stderr.includes('github_pat_ABCDEFGHIJKLMNOPQRST_123'), 'raw token must not appear in stderr')
    assert.ok(result.stderr.includes('[REDACTED_GITHUB_TOKEN]'), 'redacted placeholder in the diagnostic')
  } finally {
    tmp.clean()
  }
})

test('boundary redaction: --gh-bin path with a token-like name and spawn ENOENT is sanitized', () => {
  const { tmp, repo } = setup()
  try {
    const result = runScript(SCRIPTS.inspectPrChecks, ['--repo', repo, '--pr', '1', '--json', '--gh-bin', `${tmp.dir}/ghp_ABCDEFGHIJKLMNOPQRST-missing`])
    assert.equal(result.status, 2)
    assert.ok(!result.stderr.includes('ghp_ABCDEFGHIJKLMNOPQRST'), 'token-like path must not reach stderr raw')
    assert.ok(result.stderr.includes('[REDACTED_GITHUB_TOKEN]'), 'redacted placeholder in the diagnostic')
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
    const result = runChecks(tmp, repo, gh)
    assert.equal(result.status, 2)
    assert.match(result.stderr, /not logged in/)
  } finally {
    tmp.clean()
  }
})

test('CI log containing a pasted token is redacted from output', () => {
  const { tmp, repo } = setup()
  try {
    const { script: gh } = createFakeGh(tmp.dir, {
      expectedRepo: 'github.com/acme/demo',
      checks: { status: 0, stdout: JSON.stringify([check('test', { conclusion: 'failure' })]) },
      runView: { status: 0, stdout: JSON.stringify({ conclusion: 'failure' }) },
      runLog: { status: 0, stdout: 'Running deploy\nUsing token github_pat_ABCDEFGHIJKLMNOPQRST_123456\nfailed\n' },
    })
    const result = runChecks(tmp, repo, gh)
    assert.equal(result.status, 1)
    assert.ok(!result.stdout.includes('github_pat_ABCDEFGHIJKLMNOPQRST_123456'), 'CI log token must not reach stdout')
    assert.ok(result.stdout.includes('[REDACTED_GITHUB_TOKEN]'), 'stable placeholder must remain')
  } finally {
    tmp.clean()
  }
})

test('gh error stderr containing a credential-bearing URL is redacted', () => {
  const { tmp, repo } = setup()
  try {
    const { script: gh } = createFakeGh(tmp.dir, {
      expectedRepo: 'github.com/acme/demo',
      checks: {
        status: 1,
        stderr: 'error: fetch failed https://user:ghp_ABCDEFGHIJKLMNOPQRST@github.com/acme/demo.git\n',
      },
    })
    const result = runChecks(tmp, repo, gh)
    assert.equal(result.status, 2)
    assert.ok(!result.stderr.includes('ghp_ABCDEFGHIJKLMNOPQRST'), 'token must not leak via error stderr')
    assert.ok(result.stderr.includes('[REDACTED_PASSWORD]') || result.stderr.includes('[REDACTED_GITHUB_TOKEN]'), 'redacted placeholder in error')
  } finally {
    tmp.clean()
  }
})
