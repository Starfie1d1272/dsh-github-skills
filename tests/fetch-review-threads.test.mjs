/**
 * fetch-review-threads.mjs unit tests, driven entirely by a fake `gh`
 * executable — no real GitHub account or network is touched.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createFakeGh, parseStdoutJson, runScript, SCRIPTS, tempDir } from './helpers.mjs'

function graphqlPage(overrides = {}) {
  return {
    data: {
      repository: {
        pullRequest: {
          number: 42,
          url: 'https://github.com/acme/demo/pull/42',
          title: 'Fix the thing',
          state: 'OPEN',
          comments: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] },
          reviews: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] },
          reviewThreads: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] },
          ...overrides,
        },
      },
    },
  }
}

function thread(overrides = {}) {
  return {
    id: 'thread-1',
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
    comments: { nodes: [] },
    ...overrides,
  }
}

test('explicit --repo and --pr fetch the full thread-aware structure', () => {
  const tmp = tempDir('frt-explicit')
  try {
    const { script: gh } = createFakeGh(tmp.dir, {
      prView: { status: 0, stdout: JSON.stringify({ number: 42, headRepositoryOwner: { login: 'acme' }, headRepository: { name: 'demo' } }) },
      graphql: [graphqlPage({
        comments: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [{ id: 'c1', body: 'hello', createdAt: '2026-01-01', updatedAt: '2026-01-02', author: { login: 'alice' } }],
        },
        reviews: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [{ id: 'r1', state: 'APPROVED', body: 'lgtm', submittedAt: '2026-01-02', author: { login: 'bob' } }],
        },
        reviewThreads: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [thread({
            id: 't1',
            isResolved: false,
            isOutdated: false,
            path: 'src/a.ts',
            line: 5,
            diffSide: 'RIGHT',
            comments: { nodes: [{ id: 'tc1', body: 'rename this', createdAt: '2026-01-01', updatedAt: '2026-01-01', author: { login: 'bob' } }] },
          })],
        },
      })],
    })
    const result = runScript(SCRIPTS.fetchReviewThreads, ['--repo', 'acme/demo', '--pr', '42', '--gh-bin', gh])
    assert.equal(result.status, 0, result.stderr)
    const out = parseStdoutJson(result)
    assert.equal(out.schemaVersion, 1)
    assert.equal(out.pullRequest.number, 42)
    assert.equal(out.pullRequest.owner, 'acme')
    assert.equal(out.conversationComments.length, 1)
    assert.equal(out.reviews[0].state, 'APPROVED')
    assert.equal(out.reviewThreads.length, 1)
    const t = out.reviewThreads[0]
    assert.equal(t.isResolved, false)
    assert.equal(t.isOutdated, false)
    assert.equal(t.path, 'src/a.ts')
    assert.equal(t.line, 5)
    assert.equal(t.diffSide, 'RIGHT')
    assert.equal(t.comments.nodes.length, 1)
  } finally {
    tmp.clean()
  }
})

test('--pr as a full URL resolves owner/repo from the URL', () => {
  const tmp = tempDir('frt-url')
  try {
    const { script: gh } = createFakeGh(tmp.dir, {
      graphql: [graphqlPage()],
    })
    const result = runScript(SCRIPTS.fetchReviewThreads, ['--pr', 'https://github.com/acme/demo/pull/42', '--gh-bin', gh])
    assert.equal(result.status, 0, result.stderr)
    const out = parseStdoutJson(result)
    assert.equal(out.pullRequest.number, 42)
    assert.equal(out.pullRequest.owner, 'acme')
  } finally {
    tmp.clean()
  }
})

test('current-branch PR resolution via gh pr view (cross-repo aware)', () => {
  const tmp = tempDir('frt-current')
  try {
    const { script: gh } = createFakeGh(tmp.dir, {
      prView: { status: 0, stdout: JSON.stringify({ number: 7, headRepositoryOwner: { login: 'fork-user' }, headRepository: { name: 'demo' } }) },
      graphql: [graphqlPage({ number: 7 })],
    })
    const result = runScript(SCRIPTS.fetchReviewThreads, ['--gh-bin', gh])
    assert.equal(result.status, 0, result.stderr)
    const out = parseStdoutJson(result)
    assert.equal(out.pullRequest.number, 7)
    assert.equal(out.pullRequest.owner, 'fork-user')
    assert.equal(out.pullRequest.repo, 'demo')
  } finally {
    tmp.clean()
  }
})

test('pagination: all three collections page to completion without duplicates', () => {
  const tmp = tempDir('frt-pagination')
  try {
    const page1 = graphqlPage({
      comments: {
        pageInfo: { hasNextPage: true, endCursor: 'c1' },
        nodes: [{ id: 'c1', body: 'one', createdAt: '2026-01-01', updatedAt: '2026-01-01', author: { login: 'a' } }],
      },
      reviews: {
        pageInfo: { hasNextPage: false, endCursor: null },
        nodes: [],
      },
      reviewThreads: {
        pageInfo: { hasNextPage: true, endCursor: 't1' },
        nodes: [thread({ id: 't1' })],
      },
    })
    const page2 = graphqlPage({
      comments: {
        pageInfo: { hasNextPage: true, endCursor: 'c2' },
        nodes: [{ id: 'c2', body: 'two', createdAt: '2026-01-02', updatedAt: '2026-01-02', author: { login: 'a' } }],
      },
      reviews: {
        pageInfo: { hasNextPage: false, endCursor: null },
        nodes: [],
      },
      reviewThreads: {
        pageInfo: { hasNextPage: false, endCursor: null },
        nodes: [thread({ id: 't2' })],
      },
    })
    const page3 = graphqlPage({
      comments: {
        pageInfo: { hasNextPage: false, endCursor: null },
        nodes: [{ id: 'c3', body: 'three', createdAt: '2026-01-03', updatedAt: '2026-01-03', author: { login: 'a' } }],
      },
      reviews: {
        pageInfo: { hasNextPage: false, endCursor: null },
        nodes: [{ id: 'r1', state: 'COMMENTED', body: '', submittedAt: '2026-01-03', author: { login: 'b' } }],
      },
      reviewThreads: {
        pageInfo: { hasNextPage: false, endCursor: null },
        nodes: [],
      },
    })
    const { script: gh } = createFakeGh(tmp.dir, { graphql: [page1, page2, page3] })
    const result = runScript(SCRIPTS.fetchReviewThreads, ['--repo', 'acme/demo', '--pr', '1', '--gh-bin', gh])
    assert.equal(result.status, 0, result.stderr)
    const out = parseStdoutJson(result)
    assert.deepEqual(out.conversationComments.map((c) => c.id), ['c1', 'c2', 'c3'], 'comments must page without duplication')
    assert.deepEqual(out.reviewThreads.map((t) => t.id), ['t1', 't2'], 'threads must page without duplication')
    assert.equal(out.reviews.length, 1)
  } finally {
    tmp.clean()
  }
})

test('resolved / unresolved / outdated / multi-comment thread fields are preserved', () => {
  const tmp = tempDir('frt-state')
  try {
    const { script: gh } = createFakeGh(tmp.dir, {
      graphql: [graphqlPage({
        reviewThreads: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [
            thread({ id: 'resolved', isResolved: true, resolvedBy: { login: 'bob' } }),
            thread({ id: 'outdated', isOutdated: true, path: 'old/file.ts', line: null }),
            thread({
              id: 'multi',
              isResolved: false,
              isOutdated: false,
              path: 'src/b.ts',
              line: 9,
              comments: {
                nodes: [
                  { id: 'm1', body: 'first', createdAt: '2026-01-01', updatedAt: '2026-01-01', author: { login: 'bob' } },
                  { id: 'm2', body: 'second', createdAt: '2026-01-02', updatedAt: '2026-01-02', author: { login: 'carol' } },
                ],
              },
            }),
          ],
        },
      })],
    })
    const result = runScript(SCRIPTS.fetchReviewThreads, ['--repo', 'acme/demo', '--pr', '1', '--gh-bin', gh])
    assert.equal(result.status, 0, result.stderr)
    const out = parseStdoutJson(result)
    const byId = Object.fromEntries(out.reviewThreads.map((t) => [t.id, t]))
    assert.equal(byId.resolved.isResolved, true)
    assert.equal(byId.resolved.resolvedBy.login, 'bob')
    assert.equal(byId.outdated.isOutdated, true)
    assert.equal(byId.multi.comments.nodes.length, 2)
    assert.equal(byId.multi.comments.nodes[1].author.login, 'carol')
  } finally {
    tmp.clean()
  }
})

test('GraphQL errors fail explicitly with non-zero exit', () => {
  const tmp = tempDir('frt-graphql-error')
  try {
    const { script: gh } = createFakeGh(tmp.dir, {
      graphql: [{ errors: [{ message: 'Field isResolved does not exist' }] }],
    })
    const result = runScript(SCRIPTS.fetchReviewThreads, ['--repo', 'acme/demo', '--pr', '1', '--gh-bin', gh])
    assert.equal(result.status, 1)
    assert.match(result.stderr, /GraphQL errors/)
    assert.equal(result.stdout, '')
  } finally {
    tmp.clean()
  }
})

test('missing pull request in the response fails explicitly', () => {
  const tmp = tempDir('frt-no-pr')
  try {
    const { script: gh } = createFakeGh(tmp.dir, {
      graphql: [{ data: { repository: { pullRequest: null } } }],
    })
    const result = runScript(SCRIPTS.fetchReviewThreads, ['--repo', 'acme/demo', '--pr', '999', '--gh-bin', gh])
    assert.equal(result.status, 1)
    assert.match(result.stderr, /no pull request/)
  } finally {
    tmp.clean()
  }
})

test('auth failure fails before any GraphQL call', () => {
  const tmp = tempDir('frt-auth')
  try {
    const { script: gh } = createFakeGh(tmp.dir, {
      auth: { status: 1, stderr: 'gh: not logged in\n' },
    })
    const result = runScript(SCRIPTS.fetchReviewThreads, ['--repo', 'acme/demo', '--pr', '1', '--gh-bin', gh])
    assert.equal(result.status, 1)
    assert.match(result.stderr, /not logged in/)
  } finally {
    tmp.clean()
  }
})

test('malformed gh JSON output fails explicitly', () => {
  const tmp = tempDir('frt-malformed')
  try {
    const { script: gh } = createFakeGh(tmp.dir, {
      prView: { status: 0, stdout: 'not json at all' },
    })
    const result = runScript(SCRIPTS.fetchReviewThreads, ['--gh-bin', gh])
    assert.equal(result.status, 1)
    assert.match(result.stderr, /failed to parse JSON/)
  } finally {
    tmp.clean()
  }
})

test('no PR on the current branch fails explicitly', () => {
  const tmp = tempDir('frt-no-branch-pr')
  try {
    const { script: gh } = createFakeGh(tmp.dir, {
      prView: { status: 1, stderr: 'no open pull requests found\n' },
    })
    const result = runScript(SCRIPTS.fetchReviewThreads, ['--gh-bin', gh])
    assert.equal(result.status, 1)
    assert.match(result.stderr, /no open pull requests/)
  } finally {
    tmp.clean()
  }
})

test('--repo without --pr fails explicitly (cannot guess the PR)', () => {
  const tmp = tempDir('frt-repo-only')
  try {
    const { script: gh } = createFakeGh(tmp.dir, {})
    const result = runScript(SCRIPTS.fetchReviewThreads, ['--repo', 'acme/demo', '--gh-bin', gh])
    assert.equal(result.status, 1)
    assert.match(result.stderr, /--pr is required/)
  } finally {
    tmp.clean()
  }
})

test('unhandled gh subcommand surfaces loudly instead of guessing', () => {
  const tmp = tempDir('frt-unhandled')
  try {
    const { script: gh } = createFakeGh(tmp.dir, {
      // No graphql scenario: the fake exits 1 with an explicit message.
    })
    const result = runScript(SCRIPTS.fetchReviewThreads, ['--repo', 'acme/demo', '--pr', '1', '--gh-bin', gh])
    assert.equal(result.status, 1)
    assert.match(result.stderr, /no graphql scenario|failed/)
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
