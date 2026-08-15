/**
 * fetch-review-threads.mjs unit tests against a PROTOCOL-AWARE fake `gh`:
 * the fake matches each GraphQL request against the cursor actually passed
 * in argv (never by call count), so pagination bugs cannot hide behind
 * canned sequences.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { createFakeGh, parseStdoutJson, runScript, SCRIPTS, tempDir } from './helpers.mjs'

/** Build a collection page payload for the protocol fake. */
function page(nodes, { hasNextPage = false, endCursor = null } = {}) {
  return { nodes, pageInfo: { hasNextPage, endCursor } }
}

/** Full pullRequest graphql scenario: comments/reviews/threads page lists. */
function scenario({ comments = [], reviews = [], threads = [] } = {}) {
  return { comments, reviews, threads }
}

function comment(id, body = 'body') {
  return { id, body, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', author: { login: 'alice' } }
}

function review(id, state = 'COMMENTED') {
  return { id, state, body: '', submittedAt: '2026-01-01T00:00:00Z', author: { login: 'bob' } }
}

function thread(id, overrides = {}) {
  return {
    id,
    isResolved: false,
    isOutdated: false,
    path: 'src/main.ts',
    line: 12,
    diffSide: 'RIGHT',
    startLine: null,
    startDiffSide: null,
    originalLine: null,
    originalStartLine: null,
    resolvedBy: null,
    comments: page([]),
    ...overrides,
  }
}

function runFetch(tmp, scenarioData, extraArgs = []) {
  const gh = createFakeGh(tmp.dir, { graphql: scenarioData })
  return { gh, result: runScript(SCRIPTS.fetchReviewThreads, ['--repo', 'acme/demo', '--pr', '1', '--gh-bin', gh.script, ...extraArgs]) }
}

function ghLog(tmp) {
  return readFileSync(join(tmp.dir, '.invocations.log'), 'utf8').trim().split('\n').map((line) => JSON.parse(line))
}

test('explicit --repo and --pr fetch the full thread-aware structure', () => {
  const tmp = tempDir('frt-explicit')
  try {
    const sc = scenario({
      comments: [{ cursor: undefined, page: page([comment('c1', 'hello')]) }],
      reviews: [{ cursor: undefined, page: page([review('r1', 'APPROVED')]) }],
      threads: [{ cursor: undefined, page: page([thread('t1', { path: 'src/a.ts', line: 5, comments: page([comment('tc1', 'rename this')]) })]) }],
    })
    const { result } = runFetch(tmp, sc)
    assert.equal(result.status, 0, result.stderr)
    const out = parseStdoutJson(result)
    assert.equal(out.schemaVersion, 1)
    assert.equal(out.pullRequest.number, 1)
    assert.equal(out.conversationComments.length, 1)
    assert.equal(out.reviews[0].state, 'APPROVED')
    const t = out.reviewThreads[0]
    assert.equal(t.isResolved, false)
    assert.equal(t.isOutdated, false)
    assert.equal(t.path, 'src/a.ts')
    assert.equal(t.line, 5)
    assert.equal(t.diffSide, 'RIGHT')
    assert.equal(t.comments.nodes.length, 1)
    assert.equal(t.commentsTruncated, false)
  } finally {
    tmp.clean()
  }
})

test('--pr as a full URL resolves owner/repo from the URL', () => {
  const tmp = tempDir('frt-url')
  try {
    const gh = createFakeGh(tmp.dir, { graphql: scenario() })
    const result = runScript(SCRIPTS.fetchReviewThreads, ['--pr', 'https://github.com/acme/demo/pull/42', '--gh-bin', gh.script])
    assert.equal(result.status, 0, result.stderr)
    const out = parseStdoutJson(result)
    assert.equal(out.pullRequest.number, 42)
    assert.equal(out.pullRequest.owner, 'acme')
  } finally {
    tmp.clean()
  }
})

test('fork PR: current-branch resolution targets the PR repository, not the fork head', () => {
  const tmp = tempDir('frt-fork')
  try {
    const gh = createFakeGh(tmp.dir, {
      prView: {
        status: 0,
        stdout: JSON.stringify({
          number: 42,
          url: 'https://github.com/acme/demo/pull/42',
          headRepositoryOwner: { login: 'alice' },
          headRepository: { name: 'demo' },
        }),
      },
      graphql: scenario(),
    })
    const result = runScript(SCRIPTS.fetchReviewThreads, ['--gh-bin', gh.script])
    assert.equal(result.status, 0, result.stderr)
    const out = parseStdoutJson(result)
    assert.equal(out.pullRequest.owner, 'acme')
    assert.equal(out.pullRequest.repo, 'demo')
    const log = ghLog(tmp)
    const graphqlCall = log.find((argv) => argv[0] === 'api' && argv[1] === 'graphql')
    assert.ok(graphqlCall !== undefined, 'graphql call must exist')
    assert.ok(graphqlCall.includes('owner=acme') && graphqlCall.includes('repo=demo'), 'graphql must target acme/demo')
    assert.ok(!graphqlCall.includes('owner=alice'), 'graphql must not target the fork head repo')
  } finally {
    tmp.clean()
  }
})

test('current-branch resolution falls back to the head repo when no URL is available', () => {
  const tmp = tempDir('frt-current-fallback')
  try {
    const gh = createFakeGh(tmp.dir, {
      prView: { status: 0, stdout: JSON.stringify({ number: 7, headRepositoryOwner: { login: 'acme' }, headRepository: { name: 'demo' } }) },
      graphql: scenario(),
    })
    const result = runScript(SCRIPTS.fetchReviewThreads, ['--gh-bin', gh.script])
    assert.equal(result.status, 0, result.stderr)
    const out = parseStdoutJson(result)
    assert.equal(out.pullRequest.owner, 'acme')
    assert.equal(out.pullRequest.repo, 'demo')
  } finally {
    tmp.clean()
  }
})

test('unequal pagination (comments=3, reviews=1, threads=2) pages independently without duplicates', () => {
  const tmp = tempDir('frt-unequal')
  try {
    const sc = scenario({
      comments: [
        { cursor: undefined, page: page([comment('c1')], { hasNextPage: true, endCursor: 'c1' }) },
        { cursor: 'c1', page: page([comment('c2')], { hasNextPage: true, endCursor: 'c2' }) },
        { cursor: 'c2', page: page([comment('c3')]) },
      ],
      reviews: [
        { cursor: undefined, page: page([review('r1')]) },
      ],
      threads: [
        { cursor: undefined, page: page([thread('t1')], { hasNextPage: true, endCursor: 't1' }) },
        { cursor: 't1', page: page([thread('t2')]) },
      ],
    })
    const { result } = runFetch(tmp, sc)
    assert.equal(result.status, 0, result.stderr)
    const out = parseStdoutJson(result)
    const ids = (items) => items.map((item) => item.id)
    assert.deepEqual(ids(out.conversationComments), ['c1', 'c2', 'c3'], 'comments must page 1→2→3 exactly once')
    assert.deepEqual(ids(out.reviews), ['r1'], 'reviews must appear exactly once')
    assert.deepEqual(ids(out.reviewThreads), ['t1', 't2'], 'threads must page exactly once')
    for (const items of [out.conversationComments, out.reviews, out.reviewThreads]) {
      const all = ids(items)
      assert.equal(new Set(all).size, all.length, `no duplicate ids in ${all.join(',')}`)
    }
    // The fake already proves cursors were passed correctly (unknown cursor
    // fails loudly); additionally assert the cursor arguments appeared.
    const log = ghLog(tmp)
    const cursors = log.filter((argv) => argv[0] === 'api' && argv[1] === 'graphql')
    assert.ok(cursors.some((argv) => argv.includes('cursor=c1')), 'c1 cursor passed')
    assert.ok(cursors.some((argv) => argv.includes('cursor=c2')), 'c2 cursor passed')
    assert.ok(cursors.some((argv) => argv.includes('cursor=t1')), 't1 cursor passed')
  } finally {
    tmp.clean()
  }
})

test('one collection empty: still resolves cleanly', () => {
  const tmp = tempDir('frt-empty')
  try {
    const sc = scenario({
      comments: [{ cursor: undefined, page: page([comment('c1')]) }],
      reviews: [],
      threads: [{ cursor: undefined, page: page([thread('t1')]) }],
    })
    const { result } = runFetch(tmp, sc)
    assert.equal(result.status, 0, result.stderr)
    const out = parseStdoutJson(result)
    assert.equal(out.conversationComments.length, 1)
    assert.deepEqual(out.reviews, [])
    assert.equal(out.reviewThreads.length, 1)
  } finally {
    tmp.clean()
  }
})

test('one collection exactly 100 + multiple collections finishing together', () => {
  const tmp = tempDir('frt-hundred')
  try {
    const hundred = Array.from({ length: 100 }, (_, index) => comment(`c${index}`))
    const sc = scenario({
      comments: [
        { cursor: undefined, page: page(hundred, { hasNextPage: true, endCursor: 'c99' }) },
        { cursor: 'c99', page: page([comment('c100')]) },
      ],
      reviews: [
        { cursor: undefined, page: page([review('r1')], { hasNextPage: true, endCursor: 'r1' }) },
        { cursor: 'r1', page: page([review('r2')]) },
      ],
      threads: [
        { cursor: undefined, page: page([thread('t1')], { hasNextPage: true, endCursor: 't1' }) },
        { cursor: 't1', page: page([thread('t2')]) },
      ],
    })
    const { result } = runFetch(tmp, sc)
    assert.equal(result.status, 0, result.stderr)
    const out = parseStdoutJson(result)
    assert.equal(out.conversationComments.length, 101)
    assert.equal(out.reviews.length, 2)
    assert.equal(out.reviewThreads.length, 2)
    const ids = out.conversationComments.map((c) => c.id)
    assert.equal(new Set(ids).size, 101, 'no duplicate ids across a 100+1 page boundary')
  } finally {
    tmp.clean()
  }
})

test('resolved / unresolved / outdated / multi-comment thread fields are preserved', () => {
  const tmp = tempDir('frt-state')
  try {
    const sc = scenario({
      comments: [{ cursor: undefined, page: page([]) }],
      reviews: [{ cursor: undefined, page: page([]) }],
      threads: [{
        cursor: undefined,
        page: page([
          thread('resolved', { isResolved: true, resolvedBy: { login: 'bob' } }),
          thread('outdated', { isOutdated: true, path: 'old/file.ts', line: null }),
          thread('multi', { path: 'src/b.ts', line: 9, comments: page([comment('m1', 'first'), comment('m2', 'second')]) }),
        ]),
      }],
    })
    const { result } = runFetch(tmp, sc)
    assert.equal(result.status, 0, result.stderr)
    const out = parseStdoutJson(result)
    const byId = Object.fromEntries(out.reviewThreads.map((t) => [t.id, t]))
    assert.equal(byId.resolved.isResolved, true)
    assert.equal(byId.resolved.resolvedBy.login, 'bob')
    assert.equal(byId.outdated.isOutdated, true)
    assert.equal(byId.multi.comments.nodes.length, 2)
    assert.equal(byId.multi.comments.nodes[1].author.login, 'alice')
    assert.equal(byId.multi.commentsTruncated, false)
  } finally {
    tmp.clean()
  }
})

test('thread with more than 100 comments is flagged truncated, never silently cut', () => {
  const tmp = tempDir('frt-truncated')
  try {
    const hundred = Array.from({ length: 100 }, (_, index) => comment(`x${index}`))
    const sc = scenario({
      comments: [{ cursor: undefined, page: page([]) }],
      reviews: [{ cursor: undefined, page: page([]) }],
      threads: [{
        cursor: undefined,
        page: page([thread('big', { comments: page(hundred, { hasNextPage: true, endCursor: 'x99' }) })]),
      }],
    })
    const { result } = runFetch(tmp, sc)
    assert.equal(result.status, 0, result.stderr)
    const out = parseStdoutJson(result)
    const big = out.reviewThreads[0]
    assert.equal(big.comments.nodes.length, 100, 'first 100 comments returned')
    assert.equal(big.commentsTruncated, true, 'truncation must be explicit')
    assert.equal(big.commentsPageInfo.hasNextPage, true)
    assert.equal(big.commentsPageInfo.endCursor, 'x99')
  } finally {
    tmp.clean()
  }
})

test('GraphQL errors fail explicitly with non-zero exit', () => {
  const tmp = tempDir('frt-graphql-error')
  try {
    // Unknown cursor/collection makes the protocol fake fail loudly.
    const gh = createFakeGh(tmp.dir, { graphql: { comments: [{ cursor: 'unexpected', page: page([]) }], reviews: [], threads: [] } })
    const result = runScript(SCRIPTS.fetchReviewThreads, ['--repo', 'acme/demo', '--pr', '1', '--gh-bin', gh.script])
    assert.equal(result.status, 1)
    assert.match(result.stderr, /no graphql page|failed/i)
  } finally {
    tmp.clean()
  }
})

test('auth failure fails before any GraphQL call', () => {
  const tmp = tempDir('frt-auth')
  try {
    const gh = createFakeGh(tmp.dir, {
      auth: { status: 1, stderr: 'gh: not logged in\n' },
    })
    const result = runScript(SCRIPTS.fetchReviewThreads, ['--repo', 'acme/demo', '--pr', '1', '--gh-bin', gh.script])
    assert.equal(result.status, 1)
    assert.match(result.stderr, /not logged in/)
  } finally {
    tmp.clean()
  }
})

test('malformed gh JSON output fails explicitly', () => {
  const tmp = tempDir('frt-malformed')
  try {
    const gh = createFakeGh(tmp.dir, {
      prView: { status: 0, stdout: 'not json at all' },
    })
    const result = runScript(SCRIPTS.fetchReviewThreads, ['--gh-bin', gh.script])
    assert.equal(result.status, 1)
    assert.match(result.stderr, /failed to parse JSON/)
  } finally {
    tmp.clean()
  }
})

test('no PR on the current branch fails explicitly', () => {
  const tmp = tempDir('frt-no-branch-pr')
  try {
    const gh = createFakeGh(tmp.dir, {
      prView: { status: 1, stderr: 'no open pull requests found\n' },
    })
    const result = runScript(SCRIPTS.fetchReviewThreads, ['--gh-bin', gh.script])
    assert.equal(result.status, 1)
    assert.match(result.stderr, /no open pull requests/)
  } finally {
    tmp.clean()
  }
})

test('--repo without --pr fails explicitly (cannot guess the PR)', () => {
  const tmp = tempDir('frt-repo-only')
  try {
    const gh = createFakeGh(tmp.dir, {})
    const result = runScript(SCRIPTS.fetchReviewThreads, ['--repo', 'acme/demo', '--gh-bin', gh.script])
    assert.equal(result.status, 1)
    assert.match(result.stderr, /--pr is required/)
  } finally {
    tmp.clean()
  }
})

test('unexpected graphql surface fails loudly instead of guessing', () => {
  const tmp = tempDir('frt-unhandled')
  try {
    const gh = createFakeGh(tmp.dir, {})
    const result = runScript(SCRIPTS.fetchReviewThreads, ['--repo', 'acme/demo', '--pr', '1', '--gh-bin', gh.script])
    assert.equal(result.status, 1)
    assert.match(result.stderr, /no graphql scenario/)
  } finally {
    tmp.clean()
  }
})

test('unknown CLI flags exit with usage error', () => {
  const tmp = tempDir('frt-usage')
  try {
    const result = runScript(SCRIPTS.fetchReviewThreads, ['--bogus'])
    assert.equal(result.status, 2)
    assert.match(result.stderr, /unknown argument/)
  } finally {
    tmp.clean()
  }
})

test('credential-shaped text in remote content is redacted from output', () => {
  const tmp = tempDir('frt-redact')
  try {
    const sc = scenario({
      comments: [{ cursor: undefined, page: page([comment('c1', 'leaked ghp_ABCDEFGHIJKLMNOPQRST here')]) }],
      reviews: [{ cursor: undefined, page: page([]) }],
      threads: [{
        cursor: undefined,
        page: page([thread('t1', { comments: page([comment('tc1', 'see github_pat_AAAAAAAAAAAAAAAAAAAAAA_XXXX token')]) })]),
      }],
    })
    const { result } = runFetch(tmp, sc)
    assert.equal(result.status, 0, result.stderr)
    assert.ok(!result.stdout.includes('ghp_ABCDEFGHIJKLMNOPQRST'), 'ghp_ token must not reach stdout')
    assert.ok(!result.stdout.includes('github_pat_AAAAAAAAAAAAAAAAAAAAAA_XXXX'), 'github_pat_ token must not reach stdout')
    assert.ok(result.stdout.includes('[REDACTED_GITHUB_TOKEN]'), 'stable placeholder must remain')
    const out = parseStdoutJson(result)
    assert.equal(out.conversationComments[0].body, 'leaked [REDACTED_GITHUB_TOKEN] here')
    assert.equal(out.reviewThreads[0].comments.nodes[0].body, 'see [REDACTED_GITHUB_TOKEN] token')
  } finally {
    tmp.clean()
  }
})
