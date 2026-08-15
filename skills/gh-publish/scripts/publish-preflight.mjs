#!/usr/bin/env node
/**
 * publish-preflight.mjs — deterministic, strictly READ-ONLY scope evidence
 * for a git working tree, so publish-scope confirmation never depends on
 * guessing.
 *
 * Outputs: git root, branch, detached state, default branch, origin URL,
 * upstream ref, porcelain status, staged/unstaged/untracked file lists,
 * per-file diff stats (staged and unstaged), ahead/behind counts, a
 * `mixedWorktree` flag, and warnings.
 *
 * SAFETY: this script performs ZERO write operations. It never runs
 * `git add`, `git commit`, `git push`, `git reset`, `git stash`,
 * `git checkout`, or `git switch`. Every command is argv-based
 * (no shell interpolation) and read-only.
 *
 * Usage:
 *   node publish-preflight.mjs [--repo <path>] [--json]
 *
 * stdout: one stable JSON document (always JSON; --json is accepted for
 * symmetry with the other helpers). stderr: diagnostics only.
 * Exit codes: 0 ok, 1 not a git repository, 2 usage error.
 */

import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const WRITE_COMMANDS = new Set(['add', 'commit', 'push', 'reset', 'stash', 'checkout', 'switch', 'rm', 'mv', 'clean', 'restore'])

export function parseArgs(argv) {
  const args = { repo: '.', json: false }
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (flag === '--repo' && value !== undefined) { args.repo = value; index += 1 }
    else if (flag === '--json') args.json = true
    else if (flag === '--help' || flag === '-h') { printUsage(); process.exit(0) }
    else {
      process.stderr.write(`publish-preflight: unknown argument ${JSON.stringify(flag)}\n`)
      printUsage()
      process.exit(2)
    }
  }
  return args
}

export function printUsage() {
  process.stdout.write(
    'Usage: node publish-preflight.mjs [--repo <path>] [--json]\n' +
    'Read-only git scope preflight. Never modifies the working tree.\n',
  )
}

/** Run git with argv only; returns {status, stdout, stderr}. Never a shell. */
function git(args, cwd, options = {}) {
  // Defense in depth: a read-only preflight must never invoke a write subcommand.
  const subcommand = args[0]
  if (WRITE_COMMANDS.has(subcommand)) {
    throw new Error(`publish-preflight: refusing to run write command git ${subcommand}`)
  }
  const result = spawnSync('git', args, {
    encoding: 'utf8',
    cwd,
    timeout: options.timeout ?? 30_000,
    maxBuffer: 16 * 1024 * 1024,
  })
  if (result.error !== undefined) throw new Error(`failed to run git: ${result.error.message}`)
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

function gitOk(args, cwd) {
  const result = git(args, cwd)
  return result.status === 0 ? result.stdout.trim() : undefined
}

function parseStatusLine(line) {
  // porcelain v1: "XY path" (renames/copies: "R  old -> new")
  if (line.length < 3) return undefined
  const code = line.slice(0, 2)
  let path = line.slice(3)
  const renameMatch = /^(.*) -> (.*)$/.exec(path)
  if (renameMatch !== null) path = renameMatch[2]
  return { code, path }
}

function isStaged(code) {
  const x = code[0]
  return x !== ' ' && x !== '?' && x !== '!'
}

function isUnstaged(code) {
  const x = code[0]
  if (x === '?') return false
  return code[1] !== ' '
}

function parseNumstat(text) {
  const files = []
  for (const line of text.split('\n')) {
    if (line === '') continue
    const [added, deleted, ...pathParts] = line.split('\t')
    if (pathParts.length === 0) continue
    files.push({
      path: pathParts.join('\t'),
      added: added === '-' ? null : Number(added),
      deleted: deleted === '-' ? null : Number(deleted),
    })
  }
  return files
}

function resolveDefaultBranch(cwd) {
  const ref = gitOk(['symbolic-ref', '-q', '--short', 'refs/remotes/origin/HEAD'], cwd)
  if (ref !== undefined && ref.startsWith('origin/')) return ref.slice('origin/'.length)
  return undefined
}

function resolveAheadBehind(cwd, upstream, branch, origin) {
  const ref = upstream ?? (branch !== undefined && origin !== undefined ? `origin/${branch}` : undefined)
  if (ref === undefined) return null
  const result = git(['rev-list', '--left-right', '--count', `${ref}...HEAD`], cwd)
  if (result.status !== 0) return null
  const [behind, ahead] = result.stdout.trim().split(/\s+/).map((value) => Number(value))
  if (!Number.isInteger(behind) || !Number.isInteger(ahead)) return null
  return { ahead, behind }
}

export function collectPreflight(repoPath) {
  const root = gitOk(['rev-parse', '--show-toplevel'], repoPath)
  if (root === undefined) throw new Error(`not inside a git repository: ${repoPath}`)

  // `git branch --show-current` exits 0 with an empty line when HEAD is
  // detached, so an empty string means "no branch" just like an undefined one.
  const branchRaw = gitOk(['branch', '--show-current'], root)
  const branch = branchRaw === '' ? undefined : branchRaw
  const detached = branch === undefined
  const head = gitOk(['rev-parse', 'HEAD'], root) ?? null
  const defaultBranch = resolveDefaultBranch(root)
  const origin = gitOk(['remote', 'get-url', 'origin'], root) ?? undefined
  const upstream = gitOk(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], root) ?? undefined

  // Multi-line outputs must NOT be trimmed globally: porcelain v1 and numstat
  // use leading columns/whitespace that a whole-output trim would corrupt.
  const statusRaw = git(['status', '--porcelain=v1'], root).stdout
  const status = statusRaw.split('\n').filter((line) => line !== '').map(parseStatusLine).filter(Boolean)
  const stagedFiles = status.filter((entry) => isStaged(entry.code)).map((entry) => entry.path)
  const unstagedFiles = status.filter((entry) => isUnstaged(entry.code)).map((entry) => entry.path)
  const untrackedFiles = status.filter((entry) => entry.code.startsWith('?')).map((entry) => entry.path)

  const stagedStat = parseNumstat(git(['diff', '--cached', '--numstat'], root).stdout)
  const unstagedStat = parseNumstat(git(['diff', '--numstat'], root).stdout)

  const aheadBehind = resolveAheadBehind(root, upstream, branch, origin)

  const warnings = []
  if (detached) warnings.push('detached HEAD: no branch is checked out')
  if (origin === undefined) warnings.push('no origin remote configured')
  if (upstream === undefined && branch !== undefined && origin !== undefined) warnings.push(`branch ${branch} has no upstream; push would need -u`)
  if (untrackedFiles.length > 0) warnings.push(`${untrackedFiles.length} untracked file(s) present`)
  if (aheadBehind !== null && aheadBehind.ahead > 0) warnings.push(`${aheadBehind.ahead} unpushed commit(s) on this branch`)
  if (aheadBehind !== null && aheadBehind.behind > 0) warnings.push(`${aheadBehind.behind} commit(s) behind the remote ref`)

  return {
    schemaVersion: 1,
    gitRoot: root,
    head,
    branch: branch ?? null,
    detached,
    defaultBranch: defaultBranch ?? null,
    origin: origin ?? null,
    upstream: upstream ?? null,
    status,
    stagedFiles,
    unstagedFiles,
    untrackedFiles,
    diffStat: { staged: stagedStat, unstaged: unstagedStat },
    aheadBehind,
    mixedWorktree: stagedFiles.length > 0 && (unstagedFiles.length > 0 || untrackedFiles.length > 0),
    warnings,
  }
}

export function main(argv) {
  const args = parseArgs(argv)
  try {
    const preflight = collectPreflight(args.repo)
    process.stdout.write(`${JSON.stringify(preflight, null, 2)}\n`)
  } catch (error) {
    process.stderr.write(`publish-preflight: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2))
}
