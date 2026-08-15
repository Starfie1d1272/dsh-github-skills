#!/usr/bin/env node
/**
 * fetch-review-threads.mjs — thread-aware read of a PR's review context.
 *
 * Fetches, via authenticated `gh api graphql`:
 *   - top-level conversation comments (issue comments on the PR)
 *   - review submissions (APPROVED / CHANGES_REQUESTED / COMMENTED)
 *   - inline review threads with resolved/outdated state and file/line anchors
 *
 * Pagination design: each collection (comments / reviews / reviewThreads) is
 * paginated by its OWN GraphQL query with its OWN cursor, so collections of
 * unequal length finish independently and are never re-read from page one.
 *
 * A single thread's comments are fetched with `comments(first: 100)`; when a
 * thread has more than 100 comments the helper does NOT silently truncate —
 * it records `commentsTruncated: true` plus the thread's `commentsPageInfo`
 * and the result must not be claimed complete for that thread.
 *
 * This is a read-only workflow helper. It never writes to GitHub, never
 * outputs credentials, and never touches `gh auth token`. All output passes
 * through conservative credential redaction (untrusted comment bodies may
 * contain pasted tokens).
 *
 * Usage:
 *   node fetch-review-threads.mjs [--repo owner/name] [--pr <number|url>]
 *                                 [--gh-bin <path>]
 *
 * With no --pr, the PR associated with the current branch is resolved via
 * `gh pr view`, targeting the PR's repository (target repo, not the fork
 * head) so review-thread queries are always correct for fork PRs.
 *
 * stdout: one stable JSON document. stderr: diagnostics only.
 * Exit codes: 0 ok, 1 error (auth, GraphQL, malformed output), 2 usage.
 */

import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

import { redact } from '../../../lib/redact.mjs'

const PR_META_FRAGMENT = `number url title state`
const PAGE_INFO = `pageInfo { hasNextPage endCursor }`

const QUERY_COMMENTS = `query($owner: String!, $repo: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      ${PR_META_FRAGMENT}
      comments(first: 100, after: $cursor) {
        ${PAGE_INFO}
        nodes { id body createdAt updatedAt author { login } }
      }
    }
  }
}`

const QUERY_REVIEWS = `query($owner: String!, $repo: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      ${PR_META_FRAGMENT}
      reviews(first: 100, after: $cursor) {
        ${PAGE_INFO}
        nodes { id state body submittedAt author { login } }
      }
    }
  }
}`

const QUERY_THREADS = `query($owner: String!, $repo: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      ${PR_META_FRAGMENT}
      reviewThreads(first: 100, after: $cursor) {
        ${PAGE_INFO}
        nodes {
          id isResolved isOutdated path line diffSide
          startLine startDiffSide originalLine originalStartLine
          resolvedBy { login }
          comments(first: 100) {
            ${PAGE_INFO}
            nodes { id body createdAt updatedAt author { login } }
          }
        }
      }
    }
  }
}`

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

/**
 * Run a command with argv only (no shell interpolation) and capture output.
 * stdout/stderr are redacted so diagnostics and data never carry raw
 * credential-shaped material.
 */
function run(argv, options = {}) {
  const result = spawnSync(argv[0], argv.slice(1), {
    encoding: 'utf8',
    input: options.input,
    timeout: options.timeout ?? 120_000,
    maxBuffer: options.maxBuffer ?? 64 * 1024 * 1024,
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

/**
 * Resolve {owner, repo, number} for the current branch PR (cross-repo aware).
 *
 * A pull request object — including its reviewThreads — belongs to its
 * TARGET repository. `gh pr view` exposes the HEAD repository, which for a
 * fork PR is the fork; querying review threads through the head repo would
 * return the wrong pullRequest (or none). The canonical PR URL always points
 * at the target repository, so it is preferred; the head repo is used only
 * as a same-repository fallback when the URL is unavailable.
 */
export function resolveCurrentBranchPr(ghBin) {
  const data = runJson([ghBin, 'pr', 'view', '--json', 'number,url,headRepositoryOwner,headRepository'])
  const number = data?.number
  if (!Number.isInteger(number)) {
    throw new Error('no PR associated with the current branch (gh pr view returned no PR number)')
  }
  const fromUrl = typeof data?.url === 'string' ? parsePrUrl(data.url) : undefined
  if (fromUrl !== undefined && fromUrl.number === number) {
    return { owner: fromUrl.owner, repo: fromUrl.repo, number }
  }
  const owner = data?.headRepositoryOwner?.login
  const repo = data?.headRepository?.name
  if (typeof owner !== 'string' || typeof repo !== 'string') {
    throw new Error('no PR associated with the current branch (gh pr view returned no target/head repo)')
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

function graphqlQuery(ghBin, { owner, repo, number }, query, cursor) {
  const argv = [
    ghBin, 'api', 'graphql',
    '-F', 'query=@-',
    '-F', `owner=${owner}`,
    '-F', `repo=${repo}`,
    '-F', `number=${number}`,
  ]
  if (cursor !== undefined) argv.push('-F', `cursor=${cursor}`)
  const payload = runJson(argv, { input: query })
  if (Array.isArray(payload.errors) && payload.errors.length > 0) {
    throw new Error(`GitHub GraphQL errors:\n${JSON.stringify(payload.errors, null, 2)}`)
  }
  return payload
}

/**
 * Paginate ONE collection with its own cursor until hasNextPage is false.
 * A finished collection is never requested again, so unequal-length
 * collections cannot re-read page one.
 */
function paginateCollection(ghBin, target, query, fieldName) {
  const all = []
  let cursor
  let pageInfo
  let pullRequest
  for (;;) {
    const payload = graphqlQuery(ghBin, target, query, cursor)
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
    const page = pr[fieldName]
    all.push(...(page?.nodes ?? []))
    pageInfo = page?.pageInfo
    if (pageInfo?.hasNextPage === true) {
      cursor = pageInfo.endCursor
    } else {
      break
    }
  }
  return { items: all, pageInfo, pullRequest }
}

/** Fetch every page of comments, reviews, and threads independently. */
export function fetchAll(ghBin, target) {
  // PR metadata rides the first (comments) query.
  const comments = paginateCollection(ghBin, target, QUERY_COMMENTS, 'comments')
  const reviews = paginateCollection(ghBin, target, QUERY_REVIEWS, 'reviews')
  const threads = paginateCollection(ghBin, target, QUERY_THREADS, 'reviewThreads')

  const pullRequest = comments.pullRequest ?? {
    number: target.number,
    url: null,
    title: null,
    state: null,
    owner: target.owner,
    repo: target.repo,
  }
  const reviewThreads = threads.items.map((thread) => {
    const threadComments = thread.comments?.nodes ?? []
    const hasMore = thread.comments?.pageInfo?.hasNextPage === true
    return {
      ...thread,
      comments: { nodes: threadComments },
      commentsTruncated: hasMore,
      commentsPageInfo: thread.comments?.pageInfo ?? null,
    }
  })

  return {
    schemaVersion: 1,
    pullRequest,
    conversationComments: comments.items,
    reviews: reviews.items,
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
