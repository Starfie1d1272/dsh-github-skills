/**
 * Safety regression tests. These prove the hard rules from
 * references/safety-model.md at the code level:
 *
 *  1. read workflows perform no remote mutation
 *  2. publish-preflight performs zero writes
 *  3. a fake token never appears in stdout/stderr
 *  4. mixed worktree is detected and never triggers git add -A
 *  5. helper argv never passes through a shell string
 *  6. external CI is never treated as GitHub Actions logs
 */

import assert from 'node:assert/strict'
import { readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  createFakeGh, createFakeGit, initGitRepo, parseStdoutJson, readLog,
  ROOT, runScript, SCRIPTS, tempDir, writeFile,
} from './helpers.mjs'

const FAKE_TOKEN = 'ghp_fake_secret_1234567890'

test('fetch-review-threads performs no remote writes (invocation log audit)', () => {
  const tmp = tempDir('safety-frt')
  try {
    const { script: gh } = createFakeGh(tmp.dir, {
      graphql: { comments: [], reviews: [], threads: [] },
    })
    const result = runScript(SCRIPTS.fetchReviewThreads, ['--repo', 'acme/demo', '--pr', '1', '--gh-bin', gh], {
      env: { GITHUB_TOKEN: FAKE_TOKEN, GH_TOKEN: FAKE_TOKEN },
    })
    assert.equal(result.status, 0, result.stderr)
    const log = readFileSync(join(tmp.dir, '.invocations.log'), 'utf8').trim()
    assert.ok(log.length > 0)
    for (const line of log.split('\n')) {
      const argv = JSON.parse(line)
      // Only read surfaces are allowed: auth status, api graphql.
      assert.ok(['auth', 'api'].includes(argv[0]), `unexpected gh surface: ${argv.join(' ')}`)
      assert.equal(argv[0] === 'api' && argv[1] !== 'graphql', false, `unexpected api target: ${argv.join(' ')}`)
      assert.ok(!argv.some((a) => /-X|POST|PATCH|DELETE|PUT/i.test(a)), `mutation flag present: ${argv.join(' ')}`)
      assert.ok(!(argv[0] === 'auth' && argv[1] === 'token'), 'gh auth token must never be invoked')
    }
  } finally {
    tmp.clean()
  }
})

test('inspect-pr-checks performs no remote writes (invocation log audit)', () => {
  const tmp = tempDir('safety-ipc')
  try {
    const repo = initGitRepo(tmp.dir)
    writeFile(repo.dir, 'a.txt', 'a\n')
    repo.run(['add', '-A'])
    repo.run(['commit', '-m', 'init'])
    repo.run(['remote', 'add', 'origin', 'https://github.com/acme/demo.git'])
    const { script: gh } = createFakeGh(tmp.dir, {
      expectedRepo: 'acme/demo',
      repoView: { status: 0, stdout: JSON.stringify({ nameWithOwner: 'acme/demo' }) },
      checks: { status: 0, stdout: JSON.stringify([{ name: 'x', state: 'FAILURE', conclusion: 'failure', detailsUrl: 'https://github.com/acme/demo/actions/runs/1' }]) },
      runView: { status: 0, stdout: JSON.stringify({ conclusion: 'failure' }) },
      runLog: { status: 0, stdout: 'error: boom\n' },
    })
    const result = runScript(SCRIPTS.inspectPrChecks, ['--repo', repo.dir, '--pr', '1', '--json', '--gh-bin', gh], {
      env: { GITHUB_TOKEN: FAKE_TOKEN, GH_TOKEN: FAKE_TOKEN },
    })
    assert.equal(result.status, 1, 'failures remain → exit 1 (read-only, still allowed)')
    const log = readFileSync(join(tmp.dir, '.invocations.log'), 'utf8').trim()
    for (const line of log.split('\n')) {
      const argv = JSON.parse(line)
      assert.ok(['auth', 'pr', 'run', 'repo', 'api'].includes(argv[0]), `unexpected gh surface: ${argv.join(' ')}`)
      assert.ok(!argv.some((a) => /-X|POST|PATCH|DELETE|PUT/i.test(a)), `mutation flag present: ${argv.join(' ')}`)
      assert.ok(!(argv[0] === 'auth' && argv[1] === 'token'), 'gh auth token must never be invoked')
    }
  } finally {
    tmp.clean()
  }
})

test('publish-preflight never invokes a git write command (fake git audit)', () => {
  const tmp = tempDir('safety-preflight')
  try {
    const { script, log } = createFakeGit(tmp.dir, {
      failWrites: true,
      // rev-parse must report a root that actually exists: later git calls
      // run with that root as their cwd.
      'rev-parse': { status: 0, stdout: `${tmp.dir}\n` },
      'branch': { status: 0, stdout: 'main\n' },
      'symbolic-ref': { status: 1, stderr: 'no ref\n' },
      'remote': { status: 1, stderr: 'no remote\n' },
      'status': { status: 0, stdout: '' },
      'diff': { status: 0, stdout: '' },
      'rev-list': { status: 1, stderr: 'no upstream\n' },
    })
    const result = runScript(SCRIPTS.publishPreflight, ['--repo', tmp.dir], {
      env: { PATH: `${tmp.dir}:${process.env.PATH}` },
    })
    assert.equal(result.status, 0, result.stderr)
    const calls = readLog(log)
    assert.ok(calls.length > 0, 'fake git must have been invoked')
    const writeSubcommands = ['add', 'commit', 'push', 'reset', 'stash', 'checkout', 'switch', 'rm', 'mv', 'clean', 'restore']
    for (const argv of calls) {
      assert.ok(!writeSubcommands.includes(argv[0]), `write command invoked: ${argv.join(' ')}`)
    }
    assert.ok(!result.stdout.includes('git add'), 'output must not suggest git add')
  } finally {
    tmp.clean()
  }
})

test('a fake token in the environment never appears in helper output', () => {
  const tmp = tempDir('safety-token')
  try {
    const { script: gh } = createFakeGh(tmp.dir, {
      // Even a hostile gh response quoting the token must not reach our output
      // as credential material; env tokens must never be echoed.
      auth: { status: 0, stdout: `logged in with ${FAKE_TOKEN}\n` },
      graphql: {
        comments: [{ cursor: undefined, page: { nodes: [{ id: 'c1', body: 'see config', createdAt: 'd', updatedAt: 'd', author: { login: 'a' } }], pageInfo: { hasNextPage: false, endCursor: null } } }],
        reviews: [],
        threads: [],
      },
    })
    const result = runScript(SCRIPTS.fetchReviewThreads, ['--repo', 'acme/demo', '--pr', '1', '--gh-bin', gh], {
      env: { GITHUB_TOKEN: FAKE_TOKEN, GH_TOKEN: FAKE_TOKEN, GH_ENTERPRISE_TOKEN: FAKE_TOKEN },
    })
    assert.equal(result.status, 0, result.stderr)
    // The helper itself never prints the token: it relays no auth-token
    // material and never echoes environment credentials.
    assert.ok(!result.stdout.includes(FAKE_TOKEN), 'stdout must not contain the token')
    assert.ok(!result.stderr.includes(FAKE_TOKEN), 'stderr must not contain the token')
  } finally {
    tmp.clean()
  }
})

test('mixed worktree detection: preflight flags it and no helper runs git add -A', () => {
  const tmp = tempDir('safety-mixed')
  try {
    const repo = initGitRepo(tmp.dir)
    writeFile(repo.dir, 'a.txt', 'a\n')
    writeFile(repo.dir, 'b.txt', 'b\n')
    repo.run(['add', '-A'])
    repo.run(['commit', '-m', 'init'])
    writeFile(repo.dir, 'a.txt', 'task change\n')
    writeFile(repo.dir, 'b.txt', 'unrelated user change\n')
    repo.run(['add', 'a.txt'])
    const out = parseStdoutJson(runScript(SCRIPTS.publishPreflight, ['--repo', repo.dir]))
    assert.equal(out.mixedWorktree, true, 'staged + unstaged must be flagged mixed')
    assert.deepEqual(out.stagedFiles, ['a.txt'])
    assert.deepEqual(out.unstagedFiles, ['b.txt'])
    // No helper script may contain a blanket staging command.
    for (const script of Object.values(SCRIPTS)) {
      const source = readFileSync(script, 'utf8')
      assert.ok(!source.includes('add -A'), `${script} must not contain git add -A logic`)
    }
  } finally {
    tmp.clean()
  }
})

test('gh-publish SKILL covers the conformance edge rules', () => {
  const publish = readFileSync(join(ROOT, 'skills/gh-publish/SKILL.md'), 'utf8')
  // Partially staged files must not be blindly re-added (GAP #2).
  assert.ok(/partially staged/i.test(publish), 'must document partially staged files')
  assert.ok(/MM/.test(publish), 'must reference the MM porcelain state')
  assert.ok(/git add -p|specific hunks/.test(publish), 'must offer hunk-level staging for MM files')
  assert.ok(/scope ambiguity/.test(publish), 'must fail closed on unstaged-hunk ambiguity')
  // Existing PR on the branch must not be duplicated (GAP #3).
  assert.ok(/existing PR|already has a PR/i.test(publish), 'must check for an existing PR before creating')
  assert.ok(/do \*\*not\*\* create a second one/i.test(publish), 'must forbid duplicate PR creation')
  // Push must not hard-code origin (GAP #4).
  assert.ok(/tracked remote|upstream/.test(publish), 'must prefer the branch tracked remote')
  assert.ok(/never assume\s+the remote/i.test(publish), 'must not hard-code origin')
  // Fork publish must push to the fork remote and fail closed (GAP #5).
  assert.ok(/fork-remote|fork remote/.test(publish), 'must push to the fork remote for fork PRs')
  assert.ok(/fail closed/.test(publish), 'must fail closed when fork semantics are unclear')
})

test('helper argv is passed as separate arguments, never a shell string', () => {
  const tmp = tempDir('safety-argv')
  try {
    const { script: gh } = createFakeGh(tmp.dir, {
      graphql: { comments: [], reviews: [], threads: [] },
    })
    const result = runScript(SCRIPTS.fetchReviewThreads, ['--repo', 'acme/demo', '--pr', '1', '--gh-bin', gh])
    assert.equal(result.status, 0, result.stderr)
    const log = readFileSync(join(tmp.dir, '.invocations.log'), 'utf8')
    for (const line of log.trim().split('\n')) {
      const argv = JSON.parse(line)
      assert.ok(Array.isArray(argv))
      for (const arg of argv) assert.equal(typeof arg, 'string')
      // The query is delivered via stdin with a dedicated -F flag, not inlined.
      assert.ok(!argv.some((a) => a.includes('query(') || a.includes('reviewThreads(first')), 'query must not be inlined into argv')
    }
    // A repo path with spaces and shell metacharacters must survive argv passing.
    const weird = tempDir('safety-weird')
    try {
      const repo = initGitRepo(join(weird.dir, 'dir with spaces; $(touch pwned)'))
      writeFile(repo.dir, 'a.txt', 'a\n')
      repo.run(['add', '-A'])
      repo.run(['commit', '-m', 'init'])
      writeFile(repo.dir, 'a.txt', 'b\n')
      const out = parseStdoutJson(runScript(SCRIPTS.publishPreflight, ['--repo', repo.dir]))
      // git rev-parse reports the realpath (macOS /var → /private/var).
      assert.equal(out.gitRoot, realpathSync(repo.dir))
      assert.deepEqual(out.unstagedFiles, ['a.txt'])
    } finally {
      weird.clean()
    }
  } finally {
    tmp.clean()
  }
})

test('external CI is never log-diagnosed (no run/log surfaces called)', () => {
  const tmp = tempDir('safety-external')
  try {
    const repo = initGitRepo(tmp.dir)
    writeFile(repo.dir, 'a.txt', 'a\n')
    repo.run(['add', '-A'])
    repo.run(['commit', '-m', 'init'])
    repo.run(['remote', 'add', 'origin', 'https://github.com/acme/demo.git'])
    // No runView/runLog/repoView/jobLog scenarios: any such call fails loudly.
    const { script: gh } = createFakeGh(tmp.dir, {
      expectedRepo: 'acme/demo',
      checks: { status: 0, stdout: JSON.stringify([{ name: 'circleci', state: 'FAILURE', detailsUrl: 'https://app.circleci.com/pipelines/acme/1' }]) },
    })
    const result = runScript(SCRIPTS.inspectPrChecks, ['--repo', repo.dir, '--pr', '1', '--json', '--gh-bin', gh])
    assert.equal(result.status, 1)
    const out = parseStdoutJson(result)
    assert.equal(out.failingChecks[0].provider, 'external')
    assert.equal(out.failingChecks[0].status, 'external')
    const log = readFileSync(join(tmp.dir, '.invocations.log'), 'utf8')
    assert.ok(!log.includes('"run"'), 'run surface must never be called for external CI')
    assert.ok(!log.includes('"api"'), 'Actions job-log API must never be called for external CI')
  } finally {
    tmp.clean()
  }
})
