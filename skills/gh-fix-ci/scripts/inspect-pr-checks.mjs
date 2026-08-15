#!/usr/bin/env node
/**
 * inspect-pr-checks.mjs — extract facts about failing PR checks.
 *
 * Fetches PR checks via `gh`, identifies failures, and for GitHub Actions
 * failures pulls run metadata and bounded log evidence (with job-log
 * fallback for pending run logs). External CI providers are reported with
 * name/URL/state only — never log-diagnosed.
 *
 * GitHub Actions detection is strict: only canonical Actions URLs
 * (`/actions/runs/<id>`) are treated as Actions. Generic `/runs/<id>` paths
 * (CircleCI, self-hosted CI, ...) are external and never log-diagnosed.
 *
 * All gh queries are bound to an explicit target repository (`-R
 * <owner/repo>`): a PR URL may point at a different repository than the
 * local checkout, and Actions run/job APIs must never implicitly use the
 * cwd repository.
 *
 * This script extracts facts only. It never infers a root cause; the agent
 * decides that from the evidence. It never writes to GitHub. All output is
 * passed through conservative credential redaction.
 *
 * Usage:
 *   node inspect-pr-checks.mjs [--repo <path>] [--pr <number|url>]
 *                              [--json] [--max-lines N] [--context N]
 *                              [--gh-bin <path>]
 *
 * Exit codes: 0 = no failing checks, 1 = failures remain (automation),
 * 2 = usage/blocked (no git root, gh missing/unauthenticated, ...).
 *
 * stdout: stable JSON when --json, human-readable otherwise.
 * stderr: diagnostics only. Credentials never appear in output.
 */

import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

import { redact } from '../../../lib/redact.mjs'

const FAILURE_CONCLUSIONS = new Set(['failure', 'cancelled', 'timed_out', 'action_required'])
const FAILURE_STATES = new Set(['failure', 'error', 'cancelled', 'timed_out', 'action_required'])
const FAILURE_BUCKETS = new Set(['fail'])
const FAILURE_MARKERS = [
  'error', 'fail', 'failed', 'traceback', 'exception', 'assert', 'panic',
  'fatal', 'timeout', 'segmentation fault',
]
const PENDING_LOG_MARKERS = ['still in progress', 'log will be available when it is complete']

const DEFAULT_MAX_LINES = 160
const DEFAULT_CONTEXT_LINES = 30

export function parseArgs(argv) {
  const args = {
    repo: '.', pr: undefined, json: false,
    maxLines: DEFAULT_MAX_LINES, context: DEFAULT_CONTEXT_LINES, ghBin: 'gh',
  }
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (flag === '--repo' && value !== undefined) { args.repo = value; index += 1 }
    else if (flag === '--pr' && value !== undefined) { args.pr = value; index += 1 }
    else if (flag === '--max-lines' && value !== undefined) { args.maxLines = positiveInt(value, '--max-lines'); index += 1 }
    else if (flag === '--context' && value !== undefined) { args.context = positiveInt(value, '--context'); index += 1 }
    else if (flag === '--gh-bin' && value !== undefined) { args.ghBin = value; index += 1 }
    else if (flag === '--json') args.json = true
    else if (flag === '--help' || flag === '-h') { printUsage(); process.exit(0) }
    else {
      process.stderr.write(`inspect-pr-checks: unknown argument ${JSON.stringify(flag)}\n`)
      printUsage()
      process.exit(2)
    }
  }
  return args
}

function positiveInt(value, flag) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) {
    process.stderr.write(`inspect-pr-checks: ${flag} requires a positive integer, got ${JSON.stringify(value)}\n`)
    process.exit(2)
  }
  return parsed
}

export function printUsage() {
  process.stdout.write(
    'Usage: node inspect-pr-checks.mjs [--repo <path>] [--pr <number|url>] [--json]\n' +
    '                                  [--max-lines N] [--context N] [--gh-bin <path>]\n' +
    'Inspects failing PR checks and extracts GitHub Actions log evidence.\n',
  )
}

/** Run a command with argv only; stdout/stderr are redacted before use. */
function run(argv, options = {}) {
  const result = spawnSync(argv[0], argv.slice(1), {
    encoding: 'utf8',
    cwd: options.cwd,
    timeout: options.timeout ?? 120_000,
    maxBuffer: options.maxBuffer ?? 128 * 1024 * 1024,
  })
  if (result.error !== undefined) throw new Error(`failed to run ${argv[0]}: ${result.error.message}`)
  return {
    status: result.status,
    stdout: redact(result.stdout ?? ''),
    stderr: redact(result.stderr ?? ''),
  }
}

function runJson(argv, options = {}) {
  const result = run(argv, options)
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || '').trim() || `command failed: ${argv.join(' ')}`)
  }
  try {
    return JSON.parse(result.stdout)
  } catch (error) {
    throw new Error(`failed to parse JSON from ${argv.join(' ')}: ${error.message}`)
  }
}

function gitRoot(start) {
  const result = run(['git', 'rev-parse', '--show-toplevel'], { cwd: start })
  if (result.status !== 0) return undefined
  return result.stdout.trim()
}

export function ensureGitRoot(repoPath) {
  const root = gitRoot(repoPath)
  if (root !== undefined && root !== '') return root
  throw new Error('not inside a git repository')
}

function ensureGhAvailable(ghBin, cwd) {
  const result = run([ghBin, 'auth', 'status'], { cwd })
  if (result.status === 0) return
  throw new Error((result.stderr || result.stdout || '').trim() || 'gh not authenticated; run `gh auth login`')
}

/** Extract {owner, repo, number} from a GitHub PR URL, or undefined. */
export function parsePrUrl(url) {
  if (typeof url !== 'string') return undefined
  const match = /^https?:\/\/(?:[^/]+)\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)\/?$/.exec(url.trim())
  if (match === null) return undefined
  return { owner: match[1], repo: match[2], number: Number(match[3]) }
}

/** Best-effort owner/repo from a git remote URL (github.com / GHES / ssh). */
export function parseGitRemoteSlug(url) {
  if (typeof url !== 'string' || url === '') return undefined
  // https://host/owner/repo(.git) | git@host:owner/repo(.git) | ssh://git@host/owner/repo(.git)
  const match = /(?:[:/])([^/\s:]+)\/([^/\s]+?)(?:\.git)?$/.exec(url.trim())
  if (match === null) return undefined
  return `${match[1]}/${match[2]}`
}

/** Resolve the local checkout's repository slug via gh, then git remote. */
function resolveLocalRepoSlug(ghBin, cwd) {
  try {
    const data = runJson([ghBin, 'repo', 'view', '--json', 'nameWithOwner'], { cwd })
    const slug = data?.nameWithOwner
    if (typeof slug === 'string' && slug !== '') return slug
  } catch {
    // fall through to the git remote
  }
  const url = run(['git', 'remote', 'get-url', 'origin'], { cwd }).stdout.trim()
  const slug = parseGitRemoteSlug(url)
  if (slug !== undefined) return slug
  throw new Error('cannot resolve the repository: pass a full PR URL, or run inside a repo with an origin remote')
}

/**
 * Resolve {prValue, repoSlug} for the target PR.
 * - PR URL: the URL's owner/repo is the target (may differ from the checkout).
 * - numeric PR: bound to the LOCAL repository.
 * - no --pr: current-branch PR; the canonical PR URL gives the target repo
 *   (cross-repo aware, correct for fork PRs).
 */
export function resolveTarget(prArg, ghBin, cwd) {
  if (prArg !== undefined && prArg !== '') {
    const parsed = parsePrUrl(prArg)
    if (parsed !== undefined) {
      return { prValue: prArg, repoSlug: `${parsed.owner}/${parsed.repo}` }
    }
    if (/^\d+$/.test(prArg.trim())) {
      return { prValue: prArg.trim(), repoSlug: resolveLocalRepoSlug(ghBin, cwd) }
    }
    throw new Error(`cannot parse --pr ${JSON.stringify(prArg)}: expected a PR number or GitHub PR URL`)
  }
  const data = runJson([ghBin, 'pr', 'view', '--json', 'number,url'], { cwd })
  const number = data?.number
  if (!Number.isInteger(number)) throw new Error('no PR associated with the current branch')
  const fromUrl = typeof data?.url === 'string' ? parsePrUrl(data.url) : undefined
  if (fromUrl !== undefined && fromUrl.number === number) {
    return { prValue: String(number), repoSlug: `${fromUrl.owner}/${fromUrl.repo}` }
  }
  return { prValue: String(number), repoSlug: resolveLocalRepoSlug(ghBin, cwd) }
}

function parseAvailableFields(message) {
  if (!message.includes('Available fields:')) return []
  const fields = []
  let collecting = false
  for (const line of message.split('\n')) {
    if (line.includes('Available fields:')) { collecting = true; continue }
    if (!collecting) continue
    const field = line.trim()
    if (field === '') continue
    fields.push(field)
  }
  return fields
}

const CHECK_FIELDS = ['name', 'state', 'conclusion', 'detailsUrl', 'startedAt', 'completedAt']
const CHECK_FALLBACK_FIELDS = ['name', 'state', 'bucket', 'link', 'startedAt', 'completedAt', 'workflow']

export function fetchChecks(prValue, repoSlug, ghBin, cwd) {
  let result = run([ghBin, 'pr', 'checks', prValue, '-R', repoSlug, '--json', CHECK_FIELDS.join(',')], { cwd })
  if (result.status !== 0) {
    const message = [result.stderr, result.stdout].filter(Boolean).join('\n').trim()
    const available = parseAvailableFields(message)
    if (available.length === 0) throw new Error(message || 'gh pr checks failed')
    const selected = CHECK_FALLBACK_FIELDS.filter((field) => available.includes(field))
    if (selected.length === 0) throw new Error('no usable fields available for gh pr checks')
    result = run([ghBin, 'pr', 'checks', prValue, '-R', repoSlug, '--json', selected.join(',')], { cwd })
    if (result.status !== 0) {
      throw new Error((result.stderr || result.stdout || '').trim() || 'gh pr checks failed')
    }
  }
  let data
  try {
    data = JSON.parse(result.stdout || '[]')
  } catch (error) {
    throw new Error(`failed to parse checks JSON: ${error.message}`)
  }
  if (!Array.isArray(data)) throw new Error('unexpected checks JSON shape (expected an array)')
  return data
}

export function isFailing(check) {
  const conclusion = normalize(check.conclusion)
  if (FAILURE_CONCLUSIONS.has(conclusion)) return true
  const state = normalize(check.state ?? check.status)
  if (FAILURE_STATES.has(state)) return true
  return FAILURE_BUCKETS.has(normalize(check.bucket))
}

function normalize(value) {
  if (value === undefined || value === null) return ''
  return String(value).trim().toLowerCase()
}

/**
 * GitHub Actions detection is strict: only the canonical Actions path
 * `/actions/runs/<id>` counts (github.com and GHES both use it). A generic
 * `/runs/<id>` (CircleCI pipelines, self-hosted CI) is NOT Actions.
 */
export function extractRunId(url) {
  if (typeof url !== 'string' || url === '') return undefined
  const match = /\/actions\/runs\/(\d+)/.exec(url)
  return match === null ? undefined : match[1]
}

/** Job ids are only meaningful inside a canonical Actions run URL. */
export function extractJobId(url) {
  if (typeof url !== 'string' || url === '') return undefined
  const match = /\/actions\/runs\/\d+\/job\/(\d+)/.exec(url)
  return match === null ? undefined : match[1]
}

function fetchRunMetadata(runId, repoSlug, ghBin, cwd) {
  const fields = ['conclusion', 'status', 'workflowName', 'name', 'event', 'headBranch', 'headSha', 'url']
  try {
    return runJson([ghBin, 'run', 'view', runId, '-R', repoSlug, '--json', fields.join(',')], { cwd })
  } catch {
    return undefined
  }
}

function isPendingMessage(message) {
  const lowered = message.toLowerCase()
  return PENDING_LOG_MARKERS.some((marker) => lowered.includes(marker))
}

function isZipPayload(buffer) {
  return buffer.length > 2 && buffer[0] === 0x50 && buffer[1] === 0x4b
}

/**
 * Fetch run log bound to the target repo; on pending, fall back to the job
 * log. Returns {text, error, status}. All text is redacted.
 */
export function fetchCheckLog(runId, jobId, repoSlug, ghBin, cwd) {
  const runLog = run([ghBin, 'run', 'view', runId, '-R', repoSlug, '--log'], { cwd })
  if (runLog.status === 0) {
    return { text: runLog.stdout, error: undefined, status: 'ok' }
  }
  const runError = (runLog.stderr || runLog.stdout || '').trim() || 'gh run view failed'

  if (isPendingMessage(runError) && jobId !== undefined) {
    const endpoint = `/repos/${repoSlug}/actions/jobs/${jobId}/logs`
    const job = spawnSync(ghBin, ['api', endpoint], {
      encoding: 'buffer',
      cwd,
      timeout: 120_000,
      maxBuffer: 128 * 1024 * 1024,
    })
    if (job.error === undefined && job.status === 0) {
      if (isZipPayload(job.stdout)) {
        return { text: '', error: 'job logs returned a zip archive; unable to parse', status: 'error' }
      }
      return { text: redact(job.stdout.toString('utf8')), error: undefined, status: 'ok' }
    }
    const jobError = redact((job.stderr?.toString('utf8') || job.stdout?.toString('utf8') || '').trim())
    if (isPendingMessage(jobError)) return { text: '', error: jobError || runError, status: 'pending' }
    if (jobError !== '') return { text: '', error: jobError, status: 'error' }
    return { text: '', error: runError, status: 'pending' }
  }

  if (isPendingMessage(runError)) return { text: '', error: runError, status: 'pending' }
  return { text: '', error: runError, status: 'error' }
}

export function findFailureIndex(lines) {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const lowered = lines[index].toLowerCase()
    if (FAILURE_MARKERS.some((marker) => lowered.includes(marker))) return index
  }
  return undefined
}

export function extractFailureSnippet(logText, { maxLines, context }) {
  const lines = logText.split('\n')
  if (lines.length === 0) return ''
  const markerIndex = findFailureIndex(lines)
  if (markerIndex === undefined) return lines.slice(-maxLines).join('\n')
  const start = Math.max(0, markerIndex - context)
  const end = Math.min(lines.length, markerIndex + context)
  let window = lines.slice(start, end)
  if (window.length > maxLines) window = window.slice(-maxLines)
  return window.join('\n')
}

export function tailLines(text, maxLines) {
  if (maxLines <= 0) return ''
  return text.split('\n').slice(-maxLines).join('\n')
}

export function analyzeCheck(check, { ghBin, cwd, repoSlug, maxLines, context }) {
  const url = check.detailsUrl ?? check.link ?? ''
  const runId = extractRunId(url)
  const jobId = extractJobId(url)
  const base = {
    name: check.name ?? '',
    provider: runId === undefined ? 'external' : 'github-actions',
    detailsUrl: url,
    runId: runId ?? null,
    jobId: jobId ?? null,
  }
  if (runId === undefined) {
    return { ...base, status: 'external', note: 'No GitHub Actions run id detected in detailsUrl.', run: null, logSnippet: '', logTail: '', error: null }
  }
  const metadata = fetchRunMetadata(runId, repoSlug, ghBin, cwd)
  const log = fetchCheckLog(runId, jobId, repoSlug, ghBin, cwd)
  if (log.status === 'pending') {
    return { ...base, status: 'log_pending', note: log.error || 'Logs are not available yet.', run: metadata ?? null, logSnippet: '', logTail: '', error: null }
  }
  if (log.status === 'error') {
    return { ...base, status: 'log_unavailable', note: null, run: metadata ?? null, logSnippet: '', logTail: '', error: log.error }
  }
  return {
    ...base,
    status: 'ok',
    note: null,
    run: metadata ?? null,
    logSnippet: extractFailureSnippet(log.text, { maxLines, context }),
    logTail: tailLines(log.text, maxLines),
    error: null,
  }
}

function renderText(target, results) {
  const lines = [`PR ${target.prValue} (${target.repoSlug}): ${results.length} failing check(s) analyzed.`]
  for (const result of results) {
    lines.push(''.padEnd(60, '-'))
    lines.push(`Check: ${result.name}`)
    if (result.detailsUrl !== '') lines.push(`Details: ${result.detailsUrl}`)
    if (result.runId !== null) lines.push(`Run ID: ${result.runId}`)
    if (result.jobId !== null) lines.push(`Job ID: ${result.jobId}`)
    lines.push(`Provider: ${result.provider}`)
    lines.push(`Status: ${result.status}`)
    if (result.run !== null) {
      const branch = result.run.headBranch ?? ''
      const sha = (result.run.headSha ?? '').slice(0, 12)
      const workflow = result.run.workflowName ?? result.run.name ?? ''
      const conclusion = result.run.conclusion ?? result.run.status ?? ''
      if (workflow !== '') lines.push(`Workflow: ${workflow} (${conclusion})`)
      if (branch !== '' || sha !== '') lines.push(`Branch/SHA: ${branch} ${sha}`)
      if (result.run.url !== undefined) lines.push(`Run URL: ${result.run.url}`)
    }
    if (result.note !== null && result.note !== '') lines.push(`Note: ${result.note}`)
    if (result.error !== null && result.error !== '') {
      lines.push(`Error fetching logs: ${result.error}`)
      continue
    }
    if (result.logSnippet !== '') {
      lines.push('Failure snippet:')
      lines.push(...result.logSnippet.split('\n').map((line) => `  ${line}`))
    } else {
      lines.push('No snippet available.')
    }
  }
  lines.push(''.padEnd(60, '-'))
  return lines.join('\n')
}

export function main(argv) {
  const args = parseArgs(argv)
  let root
  try {
    root = ensureGitRoot(args.repo)
    ensureGhAvailable(args.ghBin, root)
    const target = resolveTarget(args.pr, args.ghBin, root)
    const checks = fetchChecks(target.prValue, target.repoSlug, args.ghBin, root)
    const failing = checks.filter((check) => isFailing(check))
    const results = failing.map((check) => analyzeCheck(check, {
      ghBin: args.ghBin, cwd: root, repoSlug: target.repoSlug,
      maxLines: args.maxLines, context: args.context,
    }))
    const output = { schemaVersion: 1, pr: target.prValue, repoSlug: target.repoSlug, failingChecks: results }
    if (args.json) {
      process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
    } else {
      process.stdout.write(`${renderText(target, results)}\n`)
    }
    process.exitCode = failing.length > 0 ? 1 : 0
  } catch (error) {
    process.stderr.write(`inspect-pr-checks: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 2
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2))
}
