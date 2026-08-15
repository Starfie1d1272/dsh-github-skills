#!/usr/bin/env node
/**
 * inspect-pr-checks.mjs — extract facts about failing PR checks.
 *
 * Fetches PR checks via `gh`, identifies failures, and for GitHub Actions
 * failures pulls run metadata and bounded log evidence (with job-log
 * fallback for pending run logs). External CI providers are reported with
 * name/URL/state only — never log-diagnosed.
 *
 * Host context: every query is bound to ONE explicit target
 * {host, owner, repo} resolved from the PR URL / local remote / current
 * branch PR. `-R [HOST/]OWNER/REPO` (gh >= 2.x) and `gh api --hostname`
 * carry the host; GHES works through the same path. When the host cannot be
 * determined, the helper fails closed — it never silently falls back to
 * another host.
 *
 * Actions detection is strict: canonical `/actions/runs/<id>` path AND a
 * details-URL host that matches the target host. A matching path on a
 * different host (e.g. `https://ci.example.com/actions/runs/123`) is
 * external and never log-diagnosed.
 *
 * This script extracts facts only. It never infers a root cause; the agent
 * decides that from the evidence. It never writes to GitHub. All dynamic
 * text reaching stdout/stderr is redacted at the output/error boundary.
 *
 * Usage:
 *   node inspect-pr-checks.mjs [--repo <path>] [--pr <number|url>]
 *                              [--json] [--max-lines N] [--context N]
 *                              [--gh-bin <path>]
 *
 * Exit codes: 0 = no failing checks, 1 = failures remain (automation),
 * 2 = usage/blocked (no git root, gh missing/unauthenticated, ...).
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
      process.stderr.write(`inspect-pr-checks: unknown argument ${redact(JSON.stringify(flag))}\n`)
      printUsage()
      process.exit(2)
    }
  }
  return args
}

function positiveInt(value, flag) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) {
    process.stderr.write(`inspect-pr-checks: ${flag} requires a positive integer, got ${redact(JSON.stringify(value))}\n`)
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

/**
 * Run a command with argv only. Internal state stays RAW: redaction happens
 * only at the output/error boundary so logic never sees rewritten values.
 */
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
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
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

/** Fail closed unless the exact target host has an authenticated gh session. */
function ensureHostAuthenticated(ghBin, host, cwd) {
  const result = run([ghBin, 'auth', 'status', '--hostname', host], { cwd })
  if (result.status === 0) return
  throw new Error((result.stderr || result.stdout || '').trim()
    || `gh is not authenticated for ${host}; run \`gh auth login --hostname ${host}\``)
}

/** Extract {host, owner, repo, number} from a GitHub PR URL, or undefined. */
export function parsePrUrl(url) {
  if (typeof url !== 'string') return undefined
  let parsed
  try {
    parsed = new URL(url.trim())
  } catch {
    return undefined
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return undefined
  const match = /^\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)\/?$/.exec(parsed.pathname)
  if (match === null) return undefined
  return { host: parsed.host.toLowerCase(), owner: match[1], repo: match[2], number: Number(match[3]) }
}

/**
 * Best-effort {host, owner, repo} from a git remote URL.
 * https://host/owner/repo(.git) | git@host:owner/repo(.git) |
 * ssh://git@host/owner/repo(.git).
 */
export function parseGitRemote(url) {
  if (typeof url !== 'string' || url === '') return undefined
  const https = /^https?:\/\/([^/]+)\/([^/\s]+)\/([^/\s]+?)(?:\.git)?$/.exec(url.trim())
  if (https !== null) {
    return { host: https[1].toLowerCase(), owner: https[2], repo: https[3] }
  }
  const scp = /^(?:[^@]+@)?([^:/]+):([^/\s]+)\/([^/\s]+?)(?:\.git)?$/.exec(url.trim())
  if (scp !== null) {
    return { host: scp[1].toLowerCase(), owner: scp[2], repo: scp[3] }
  }
  const ssh = /^ssh:\/\/(?:[^@]+@)?([^/]+)\/([^/\s]+)\/([^/\s]+?)(?:\.git)?$/.exec(url.trim())
  if (ssh !== null) {
    return { host: ssh[1].toLowerCase(), owner: ssh[2], repo: ssh[3] }
  }
  return undefined
}

/** Resolve the local checkout's {host, owner, repo} from its origin remote. */
function resolveLocalTarget(cwd) {
  const url = run(['git', 'remote', 'get-url', 'origin'], { cwd }).stdout.trim()
  const parsed = parseGitRemote(url)
  if (parsed === undefined) {
    throw new Error('cannot resolve the repository host: origin remote has no GitHub/GHES URL')
  }
  return parsed
}

function targetOf(parts) {
  return {
    host: parts.host,
    owner: parts.owner,
    repo: parts.repo,
    repoSelector: `${parts.host}/${parts.owner}/${parts.repo}`,
  }
}

/**
 * Resolve the explicit target {host, owner, repo, repoSelector, prValue}.
 * - PR URL: the URL's host+repo is the target (may differ from the checkout).
 * - numeric PR: bound to the LOCAL repository's origin remote host.
 * - no --pr: current-branch PR via its canonical URL (cross-repo aware).
 * Unknown host → fail closed, never a silent fallback.
 */
export function resolveTarget(prArg, ghBin, cwd) {
  if (prArg !== undefined && prArg !== '') {
    const parsed = parsePrUrl(prArg)
    if (parsed !== undefined) {
      return { prValue: prArg, ...targetOf(parsed) }
    }
    if (/^\d+$/.test(prArg.trim())) {
      return { prValue: prArg.trim(), ...targetOf(resolveLocalTarget(cwd)) }
    }
    throw new Error(`cannot parse --pr ${JSON.stringify(prArg)}: expected a PR number or GitHub PR URL`)
  }
  const data = runJson([ghBin, 'pr', 'view', '--json', 'number,url'], { cwd })
  const number = data?.number
  if (!Number.isInteger(number)) throw new Error('no PR associated with the current branch')
  const fromUrl = typeof data?.url === 'string' ? parsePrUrl(data.url) : undefined
  if (fromUrl !== undefined && fromUrl.number === number) {
    return { prValue: String(number), ...targetOf(fromUrl) }
  }
  throw new Error('cannot resolve the PR host: gh pr view returned no canonical PR URL for the current branch')
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

export function fetchChecks(prValue, repoSelector, ghBin, cwd) {
  let result = run([ghBin, 'pr', 'checks', prValue, '-R', repoSelector, '--json', CHECK_FIELDS.join(',')], { cwd })
  if (result.status !== 0) {
    const message = [result.stderr, result.stdout].filter(Boolean).join('\n').trim()
    const available = parseAvailableFields(message)
    if (available.length === 0) throw new Error(message || 'gh pr checks failed')
    const selected = CHECK_FALLBACK_FIELDS.filter((field) => available.includes(field))
    if (selected.length === 0) throw new Error('no usable fields available for gh pr checks')
    result = run([ghBin, 'pr', 'checks', prValue, '-R', repoSelector, '--json', selected.join(',')], { cwd })
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
 * GitHub Actions detection is strict: canonical `/actions/runs/<id>` path
 * (with owner/repo segments) AND a details-URL host that matches the target
 * host. A matching path on any other host (or a generic `/runs/<id>`) is
 * NOT Actions.
 */
function isActionsUrl(url, targetHost) {
  if (typeof url !== 'string' || url === '') return false
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false
  if (parsed.host.toLowerCase() !== targetHost) return false
  return /^\/[^/\s]+\/[^/\s]+\/actions\/runs\/\d+/.test(parsed.pathname)
}

export function extractRunId(url, targetHost) {
  if (!isActionsUrl(url, targetHost)) return undefined
  const match = /\/actions\/runs\/(\d+)/.exec(url)
  return match === null ? undefined : match[1]
}

export function extractJobId(url, targetHost) {
  if (!isActionsUrl(url, targetHost)) return undefined
  const match = /\/actions\/runs\/\d+\/job\/(\d+)/.exec(url)
  return match === null ? undefined : match[1]
}

function fetchRunMetadata(runId, repoSelector, ghBin, cwd) {
  const fields = ['conclusion', 'status', 'workflowName', 'name', 'event', 'headBranch', 'headSha', 'url']
  try {
    return runJson([ghBin, 'run', 'view', runId, '-R', repoSelector, '--json', fields.join(',')], { cwd })
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
 * Fetch run log bound to the target repo/host; on pending, fall back to the
 * job log. Returns {text, error, status} with RAW content (redacted at the
 * output boundary).
 */
export function fetchCheckLog(runId, jobId, target, ghBin, cwd) {
  const runLog = run([ghBin, 'run', 'view', runId, '-R', target.repoSelector, '--log'], { cwd })
  if (runLog.status === 0) {
    return { text: runLog.stdout, error: undefined, status: 'ok' }
  }
  const runError = (runLog.stderr || runLog.stdout || '').trim() || 'gh run view failed'

  if (isPendingMessage(runError) && jobId !== undefined) {
    const endpoint = `/repos/${target.owner}/${target.repo}/actions/jobs/${jobId}/logs`
    const job = spawnSync(ghBin, ['api', '--hostname', target.host, endpoint], {
      encoding: 'buffer',
      cwd,
      timeout: 120_000,
      maxBuffer: 128 * 1024 * 1024,
    })
    if (job.error === undefined && job.status === 0) {
      if (isZipPayload(job.stdout)) {
        return { text: '', error: 'job logs returned a zip archive; unable to parse', status: 'error' }
      }
      return { text: job.stdout.toString('utf8'), error: undefined, status: 'ok' }
    }
    const jobError = (job.stderr?.toString('utf8') || job.stdout?.toString('utf8') || '').trim()
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

export function analyzeCheck(check, { ghBin, cwd, target, maxLines, context }) {
  const url = check.detailsUrl ?? check.link ?? ''
  const runId = extractRunId(url, target.host)
  const jobId = extractJobId(url, target.host)
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
  const metadata = fetchRunMetadata(runId, target.repoSelector, ghBin, cwd)
  const log = fetchCheckLog(runId, jobId, target, ghBin, cwd)
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
  const lines = [`PR ${target.prValue} (${target.repoSelector}): ${results.length} failing check(s) analyzed.`]
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
    const target = resolveTarget(args.pr, args.ghBin, root)
    ensureHostAuthenticated(args.ghBin, target.host, root)
    const checks = fetchChecks(target.prValue, target.repoSelector, args.ghBin, root)
    const failing = checks.filter((check) => isFailing(check))
    const results = failing.map((check) => analyzeCheck(check, {
      ghBin: args.ghBin, cwd: root, target,
      maxLines: args.maxLines, context: args.context,
    }))
    const output = {
      schemaVersion: 1,
      pr: target.prValue,
      repoSlug: `${target.owner}/${target.repo}`,
      host: target.host,
      failingChecks: results,
    }
    if (args.json) {
      process.stdout.write(`${redact(JSON.stringify(output, null, 2))}\n`)
    } else {
      process.stdout.write(`${redact(renderText(target, results))}\n`)
    }
    process.exitCode = failing.length > 0 ? 1 : 0
  } catch (error) {
    process.stderr.write(`inspect-pr-checks: ${redact(error instanceof Error ? error.message : String(error))}\n`)
    process.exitCode = 2
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2))
}
