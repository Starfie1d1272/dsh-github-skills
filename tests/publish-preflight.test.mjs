/**
 * publish-preflight.mjs tests against REAL disposable git repositories
 * (created and torn down per test). No network, no user repos.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { initGitRepo, parseStdoutJson, runScript, SCRIPTS, tempDir, writeFile } from './helpers.mjs'

function runPreflight(repo) {
  return runScript(SCRIPTS.publishPreflight, ['--repo', repo])
}

function commitAll(repo, message) {
  repo.run(['add', '-A'])
  repo.run(['commit', '-m', message])
}

test('clean repo: empty scope, not mixed', () => {
  const tmp = tempDir('pp-clean')
  try {
    const repo = initGitRepo(tmp.dir)
    writeFile(repo.dir, 'a.txt', 'a\n')
    commitAll(repo, 'init')
    const result = runPreflight(repo.dir)
    assert.equal(result.status, 0, result.stderr)
    const out = parseStdoutJson(result)
    assert.equal(out.schemaVersion, 1)
    assert.equal(out.detached, false)
    assert.equal(out.branch, 'main')
    assert.deepEqual(out.stagedFiles, [])
    assert.deepEqual(out.unstagedFiles, [])
    assert.deepEqual(out.untrackedFiles, [])
    assert.equal(out.mixedWorktree, false)
    assert.ok(Array.isArray(out.warnings))
  } finally {
    tmp.clean()
  }
})

test('dirty repo with unstaged changes', () => {
  const tmp = tempDir('pp-dirty')
  try {
    const repo = initGitRepo(tmp.dir)
    writeFile(repo.dir, 'a.txt', 'a\n')
    commitAll(repo, 'init')
    writeFile(repo.dir, 'a.txt', 'b\n')
    const out = parseStdoutJson(runPreflight(repo.dir))
    assert.deepEqual(out.unstagedFiles, ['a.txt'])
    assert.deepEqual(out.stagedFiles, [])
    assert.equal(out.mixedWorktree, false)
    assert.equal(out.diffStat.unstaged.length, 1)
  } finally {
    tmp.clean()
  }
})

test('staged-only repo', () => {
  const tmp = tempDir('pp-staged')
  try {
    const repo = initGitRepo(tmp.dir)
    writeFile(repo.dir, 'a.txt', 'a\n')
    commitAll(repo, 'init')
    writeFile(repo.dir, 'a.txt', 'c\n')
    repo.run(['add', 'a.txt'])
    const out = parseStdoutJson(runPreflight(repo.dir))
    assert.deepEqual(out.stagedFiles, ['a.txt'])
    assert.deepEqual(out.unstagedFiles, [])
    assert.equal(out.mixedWorktree, false)
  } finally {
    tmp.clean()
  }
})

test('untracked-only repo', () => {
  const tmp = tempDir('pp-untracked')
  try {
    const repo = initGitRepo(tmp.dir)
    writeFile(repo.dir, 'a.txt', 'a\n')
    commitAll(repo, 'init')
    writeFile(repo.dir, 'new.txt', 'n\n')
    const out = parseStdoutJson(runPreflight(repo.dir))
    assert.deepEqual(out.untrackedFiles, ['new.txt'])
    assert.equal(out.mixedWorktree, false)
    assert.ok(out.warnings.some((w) => w.includes('untracked')))
  } finally {
    tmp.clean()
  }
})

test('mixed worktree (staged + unstaged) is flagged', () => {
  const tmp = tempDir('pp-mixed')
  try {
    const repo = initGitRepo(tmp.dir)
    writeFile(repo.dir, 'a.txt', 'a\n')
    writeFile(repo.dir, 'b.txt', 'b\n')
    commitAll(repo, 'init')
    writeFile(repo.dir, 'a.txt', 'a2\n')
    writeFile(repo.dir, 'b.txt', 'b2\n')
    repo.run(['add', 'a.txt'])
    const out = parseStdoutJson(runPreflight(repo.dir))
    assert.deepEqual(out.stagedFiles, ['a.txt'])
    assert.deepEqual(out.unstagedFiles, ['b.txt'])
    assert.equal(out.mixedWorktree, true)
  } finally {
    tmp.clean()
  }
})

test('feature branch is reported with the branch name', () => {
  const tmp = tempDir('pp-feature')
  try {
    const repo = initGitRepo(tmp.dir, { branch: 'feature/thing' })
    writeFile(repo.dir, 'a.txt', 'a\n')
    commitAll(repo, 'init')
    const out = parseStdoutJson(runPreflight(repo.dir))
    assert.equal(out.branch, 'feature/thing')
    assert.equal(out.detached, false)
  } finally {
    tmp.clean()
  }
})

test('detached HEAD is reported', () => {
  const tmp = tempDir('pp-detached')
  try {
    const repo = initGitRepo(tmp.dir)
    writeFile(repo.dir, 'a.txt', 'a\n')
    commitAll(repo, 'init')
    repo.run(['checkout', '--detach'])
    const out = parseStdoutJson(runPreflight(repo.dir))
    assert.equal(out.detached, true)
    assert.equal(out.branch, null)
    assert.ok(out.warnings.some((w) => w.includes('detached')))
  } finally {
    tmp.clean()
  }
})

test('no origin remote is reported with a warning', () => {
  const tmp = tempDir('pp-noorigin')
  try {
    const repo = initGitRepo(tmp.dir)
    writeFile(repo.dir, 'a.txt', 'a\n')
    commitAll(repo, 'init')
    const out = parseStdoutJson(runPreflight(repo.dir))
    assert.equal(out.origin, null)
    assert.ok(out.warnings.some((w) => w.includes('no origin')))
  } finally {
    tmp.clean()
  }
})

test('ahead/behind vs origin is computed when upstream exists', () => {
  const tmp = tempDir('pp-ab')
  try {
    const repo = initGitRepo(tmp.dir)
    writeFile(repo.dir, 'a.txt', 'a\n')
    commitAll(repo, 'init')
    // Create a bare "remote" and push, then add a local commit.
    const remoteDir = `${tmp.dir}-remote`
    repo.run(['init', '--bare', remoteDir])
    repo.run(['remote', 'add', 'origin', remoteDir])
    repo.run(['push', '-u', 'origin', 'main'])
    writeFile(repo.dir, 'a.txt', 'a\nb\n')
    commitAll(repo, 'local commit')
    const out = parseStdoutJson(runPreflight(repo.dir))
    assert.equal(out.origin, remoteDir)
    assert.equal(out.upstream, 'origin/main')
    assert.ok(out.aheadBehind !== null)
    assert.equal(out.aheadBehind.ahead, 1)
    assert.equal(out.aheadBehind.behind, 0)
    assert.ok(out.warnings.some((w) => w.includes('1 unpushed commit')))
  } finally {
    tmp.clean()
  }
})

test('default branch is resolved from origin/HEAD when configured', () => {
  const tmp = tempDir('pp-default')
  try {
    const repo = initGitRepo(tmp.dir)
    writeFile(repo.dir, 'a.txt', 'a\n')
    commitAll(repo, 'init')
    const remoteDir = `${tmp.dir}-remote`
    repo.run(['init', '--bare', remoteDir])
    repo.run(['remote', 'add', 'origin', remoteDir])
    repo.run(['push', '-u', 'origin', 'main'])
    repo.run(['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main'])
    const out = parseStdoutJson(runPreflight(repo.dir))
    assert.equal(out.defaultBranch, 'main')
  } finally {
    tmp.clean()
  }
})

test('status entries carry porcelain codes', () => {
  const tmp = tempDir('pp-codes')
  try {
    const repo = initGitRepo(tmp.dir)
    writeFile(repo.dir, 'a.txt', 'a\n')
    commitAll(repo, 'init')
    writeFile(repo.dir, 'a.txt', 'changed\n')
    writeFile(repo.dir, 'brand-new.txt', 'x\n')
    repo.run(['add', 'a.txt'])
    const out = parseStdoutJson(runPreflight(repo.dir))
    const codes = out.status.map((entry) => entry.code)
    assert.ok(codes.includes('M '), `staged modification code present: ${codes}`)
    assert.ok(codes.includes('??'), `untracked code present: ${codes}`)
  } finally {
    tmp.clean()
  }
})

test('not a git repository fails explicitly', () => {
  const tmp = tempDir('pp-nogit')
  try {
    const result = runPreflight(tmp.dir)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /not inside a git repository/)
  } finally {
    tmp.clean()
  }
})

test('repo state is untouched: preflight leaves a dirty tree exactly as it was', () => {
  const tmp = tempDir('pp-nomutate')
  try {
    const repo = initGitRepo(tmp.dir)
    writeFile(repo.dir, 'a.txt', 'a\n')
    commitAll(repo, 'init')
    writeFile(repo.dir, 'a.txt', 'dirty\n')
    const before = repo.run(['status', '--porcelain'])
    parseStdoutJson(runPreflight(repo.dir))
    const after = repo.run(['status', '--porcelain'])
    assert.equal(after, before, 'working tree status must be identical after preflight')
    const log = repo.run(['log', '--oneline'])
    assert.equal(log.split('\n').length, 1, 'no new commits may be created')
  } finally {
    tmp.clean()
  }
})
