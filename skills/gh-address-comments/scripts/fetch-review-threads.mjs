#!/usr/bin/env node
/**
 * fetch-review-threads.mjs — thread-aware read of a PR's review context.
 *
 * Fetches, via authenticated `gh api graphql`:
 *   - top-level conversation comments (issue comments on the PR)
 *   - review submissions (APPROVED / CHANGES_REQUESTED / COMMENTED)
 *   - inline review threads with resolved/outdated state and file/line anchors
 *
 * This is a read-only workflow helper. It never writes to GitHub, never
 * outputs credentials, and never touches `gh auth token`.
 *
 * Usage:
 *   node fetch-review-threads.mjs [--repo owner/name] [--pr <number|url>]
 *                                 [--gh-bin <path>]
 *
 * With no --pr, the PR associated with the current branch is resolved via
 * `gh pr view` (works for cross-repo PRs by reading head repo owner/name).
 *
 * stdout: one stable JSON document. stderr: diagnostics only.
 * Exit codes: 0 ok, 1 error (auth, GraphQL, malformed output).
 */

import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const QUERY = `query(
  $owner: String!,
  $repo: String!,
  $number: Int!,
  $commentsCursor: String,
  $reviewsCursor: String,
  $threadsCursor: String
) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      number
      url
      title
      state
      comments(first: 100, after: $commentsCursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id body createdAt updatedAt author { login }
        }
      }
      reviews(first: 100, after: $reviewsCursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id state body submittedAt author { login }
        }
      }
      reviewThreads(first: 100, after: $threadsCursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id isResolved isOutdated path line diffSide
          startLine startDiffSide originalLine originalStartLine
          resolvedBy { login }
          comments(first: 100) {
            nodes {
              id body createdAt updatedAt author { login }
            }
          }
        }
      }
    }
  }
}
`

export function parseArgs(argv) {
  const args = { repo: undefined, pr: undefined, ghBin: 'gh' }
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (flag === '--repo' && value !== undefined) { args.repo = value; index += 1 }
    else if (flag === '--pr' && value !== undefined) { args.pr = value; index += 1 }
    else if (flag === '--gh-bin' && value !== undefined) { args.ghBin = value; index += 1 }
    else if (flag === '--help' || flag === '-h') { printUsage(); process.exit(0) }
    else {
      process.stderr.write(`fetch-review-threads: unknown argument ${JSON.stringify(flag)}\n`)
      printUsage()
      process.exit(2)
    }
  }
  return args
}

export function printUsage() {
  process.stdout.write(
    'Usage: node fetch-review-threads.mjs [--repo owner/name] [--pr <number|url>] [--gh-bin <path>]\n' +
    'Fetches conversation comments, reviews, and inline review threads for a PR.\n' +
    'With no --pr, resolves the current branch PR via `gh pr view`.\n',
  )
}

/** Split "owner/name" into {owner, repo}; returns undefined when invalid. */
export function parseRepoSpec(spec) {
  if (typeof spec !== 'string') return undefined
  const match = /^([^/\s]+)\/([^/\s]+)$/.exec(spec.trim())
  if (match === null) return undefined
  return { owner: match[1], repo: match[2] }
}

/** Extract {owner, repo, number} from a GitHub PR URL, or undefined. */
export function parsePrUrl(url) {
  if (typeof url !== 'string') return undefined
  const match = /^https?:\/\/(?:[^/]+)\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)\/?$/.exec(url.trim())
  if (match === null) return undefined
  return { owner: match[1], repo: match[2], number: Number(match[3]) }
}

/** Run a command with argv only (no shell interpolation) and capture output. */
function run(argv, options = {}) {
  const result = spawnSync(argv[0], argv.slice(1), {
    encoding: 'utf8',
    input: options.input,
    timeout: options.timeout ?? 120_000,
    maxBuffer: options.maxBuffer ?? 64 * 1024 * 1024,
  })
  if (result.error !== undefined) throw new Error(`failed to run ${argv[0]}: ${result.error.message}`)
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

function runJson(argv, options = {}) {
  const result = run(argv, options)
  if (result.status !== 0) {
    const message = (result.stderr || result.stdout || '').trim()
    throw new Error(message || `command failed: ${argv.join(' ')}`)
  }
  try {
    return JSON.parse(result.stdout)
  } catch (error) {
    throw new Error(`failed to parse JSON from ${argv.join(' ')}: ${error.message}`)
  }
}

function ensureAuthenticated(ghBin) {
  const result = run([ghBin, 'auth', 'status'])
  if (result.status === 0) return
  const message = (result.stderr || result.stdout || '').trim()
  throw new Error(message || 'gh auth status failed; run `gh auth login` to authenticate the GitHub CLI')
}

/** Resolve {owner, repo, number} for the current branch PR (cross-repo aware). */
export function resolveCurrentBranchPr(ghBin) {
  const data = runJson([ghBin, 'pr', 'view', '--json', 'number,headRepositoryOwner,headRepository'])
  const owner = data?.headRepositoryOwner?.login
  const repo = data?.headRepository?.name
  const number = data?.number
  if (typeof owner !== 'string' || typeof repo !== 'string' || !Number.isInteger(number)) {
    throw new Error('no PR associated with the current branch (gh pr view returned no head repo/number)')
  }
  return { owner, repo, number }
}

/** Resolve {owner, repo, number} from explicit repo/pr arguments. */
export function resolveTarget(args, ghBin) {
  let owner
  let repo
  let number
  if (args.pr !== undefined && args.pr !== '') {
    const asUrl = parsePrUrl(args.pr)
    if (asUrl !== undefined) {
      owner = asUrl.owner
      repo = asUrl.repo
      number = asUrl.number
    } else if (/^\d+$/.test(args.pr.trim())) {
      number = Number(args.pr.trim())
    } else {
      throw new Error(`cannot parse --pr ${JSON.stringify(args.pr)}: expected a PR number or GitHub PR URL`)
    }
  }
  if (args.repo !== undefined && args.repo !== '') {
    const split = parseRepoSpec(args.repo)
    if (split === undefined) throw new Error(`cannot parse --repo ${JSON.stringify(args.repo)}: expected owner/name`)
    owner = split.owner
    repo = split.repo
  }
  if (number === undefined) {
    if (owner !== undefined || repo !== undefined) {
      throw new Error('--pr is required when --repo is given (no PR number/URL to resolve)')
    }
    const current = resolveCurrentBranchPr(ghBin)
    owner = current.owner
    repo = current.repo
    number = current.number
  }
  if (owner === undefined || repo === undefined) {
    throw new Error('cannot resolve the repository: pass --repo owner/name or a full PR URL')
  }
  return { owner, repo, number }
}

function graphqlPage(ghBin, { owner, repo, number }, cursors) {
  const argv = [
    ghBin, 'api', 'graphql',
    '-F', 'query=@-',
    '-F', `owner=${owner}`,
    '-F', `repo=${repo}`,
    '-F', `number=${number}`,
  ]
  if (cursors.comments !== undefined) argv.push('-F', `commentsCursor=${cursors.comments}`)
  if (cursors.reviews !== undefined) argv.push('-F', `reviewsCursor=${cursors.reviews}`)
  if (cursors.threads !== undefined) argv.push('-F', `threadsCursor=${cursors.threads}`)
  const payload = runJson(argv, { input: QUERY })
  if (Array.isArray(payload.errors) && payload.errors.length > 0) {
    throw new Error(`GitHub GraphQL errors:\n${JSON.stringify(payload.errors, null, 2)}`)
  }
  return payload
}

/** Fetch every page of comments, reviews, and threads. Pure logic, no I/O beyond gh. */
export function fetchAll(ghBin, target) {
  const conversationComments = []
  const reviews = []
  const reviewThreads = []
  const cursors = { comments: undefined, reviews: undefined, threads: undefined }
  let pullRequest = undefined
  for (;;) {
    const payload = graphqlPage(ghBin, target, cursors)
    const pr = payload?.data?.repository?.pullRequest
    if (pr === undefined || pr === null) {
      throw new Error(`GitHub GraphQL returned no pull request for ${target.owner}/${target.repo}#${target.number}`)
    }
    if (pullRequest === undefined) {
      pullRequest = {
        number: pr.number ?? target.number,
        url: pr.url ?? null,
        title: pr.title ?? null,
        state: pr.state ?? null,
        owner: target.owner,
        repo: target.repo,
      }
    }
    conversationComments.push(...(pr.comments?.nodes ?? []))
    reviews.push(...(pr.reviews?.nodes ?? []))
    reviewThreads.push(...(pr.reviewThreads?.nodes ?? []))
    // A collection that reports hasNextPage:false gets its cursor cleared so
    // later pages never re-request (and re-append) an already-finished list.
    cursors.comments = pr.comments?.pageInfo?.hasNextPage === true ? pr.comments.pageInfo.endCursor : undefined
    cursors.reviews = pr.reviews?.pageInfo?.hasNextPage === true ? pr.reviews.pageInfo.endCursor : undefined
    cursors.threads = pr.reviewThreads?.pageInfo?.hasNextPage === true ? pr.reviewThreads.pageInfo.endCursor : undefined
    if (cursors.comments === undefined && cursors.reviews === undefined && cursors.threads === undefined) break
  }
  return {
    schemaVersion: 1,
    pullRequest: pullRequest ?? null,
    conversationComments,
    reviews,
    reviewThreads,
  }
}

export function main(argv) {
  const args = parseArgs(argv)
  let result
  try {
    ensureAuthenticated(args.ghBin)
    const target = resolveTarget(args, args.ghBin)
    result = fetchAll(args.ghBin, target)
  } catch (error) {
    process.stderr.write(`fetch-review-threads: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
    return
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2))
}
