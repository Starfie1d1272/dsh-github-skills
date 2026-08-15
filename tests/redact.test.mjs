/**
 * lib/redact.mjs unit tests: the conservative credential redaction shared
 * by every helper. Proves secret-shaped material never survives output and
 * ordinary prose is never mangled.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { redact, redactJson, REDACTED_CREDENTIAL, REDACTED_PASSWORD, REDACTED_TOKEN } from '../lib/redact.mjs'

test('redacts GitHub token prefixes with a stable placeholder', () => {
  for (const prefix of ['ghp_', 'gho_', 'ghu_', 'ghs_', 'ghr_']) {
    const token = `${prefix}${'A'.repeat(30)}`
    assert.equal(redact(`leaked ${token} here`), `leaked ${REDACTED_TOKEN} here`, prefix)
  }
  assert.equal(redact('github_pat_AAAAAAAAAAAAAAAAAAAAAA_12345678901234567890123456789012345'),
    REDACTED_TOKEN, 'github_pat_ form')
})

test('redacts https remote userinfo passwords, keeping the username', () => {
  assert.equal(
    redact('https://user:ghp_ABCDEFGHIJKLMNOPQRST@github.com/acme/demo.git'),
    `https://user:${REDACTED_PASSWORD}@github.com/acme/demo.git`,
  )
})

test('redacts a bare https token-as-userinfo', () => {
  assert.equal(
    redact('https://ghp_ABCDEFGHIJKLMNOPQRST@github.com/acme/demo.git'),
    `https://${REDACTED_CREDENTIAL}@github.com/acme/demo.git`,
  )
})

test('redacts GHES https remote with credentials', () => {
  assert.equal(
    redact('https://oauth2:github_pat_AAAAAAAAAAAAAAAAAAAAAA_1111@ghes.internal/acme/demo.git'),
    `https://oauth2:${REDACTED_PASSWORD}@ghes.internal/acme/demo.git`,
  )
})

test('does not mangle ssh git@ remotes or plain URLs', () => {
  assert.equal(redact('git@github.com:acme/demo.git'), 'git@github.com:acme/demo.git')
  assert.equal(redact('ssh://git@github.com/acme/demo.git'), 'ssh://git@github.com/acme/demo.git')
  assert.equal(redact('https://github.com/acme/demo.git'), 'https://github.com/acme/demo.git')
  assert.equal(redact('https://ci.example.com/runs/123'), 'https://ci.example.com/runs/123')
})

test('does not rewrite ordinary prose', () => {
  const prose = 'The quick brown fox jumps over the lazy dog. Tests passed: 12. Path: src/a.txt'
  assert.equal(redact(prose), prose)
})

test('redact is idempotent (already-redacted output is not re-matched)', () => {
  const once = redact('https://user:ghp_ABCDEFGHIJKLMNOPQRST@github.com/acme/demo.git')
  const twice = redact(once)
  assert.equal(once, twice, 'second pass must not change the output')
  assert.ok(!twice.includes('ghp_'), 'no raw token anywhere')
})

test('redactJson walks nested JSON values', () => {
  const value = {
    body: 'token ghp_ABCDEFGHIJKLMNOPQRST leaked',
    comments: [{ text: 'github_pat_AAAAAAAAAAAAAAAAAAAAAA_2222' }],
    count: 3,
    nested: { url: 'https://user:ghp_ABCDEFGHIJKLMNOPQRST@host/x' },
  }
  const out = redactJson(value)
  assert.equal(out.body, `token ${REDACTED_TOKEN} leaked`)
  assert.equal(out.comments[0].text, REDACTED_TOKEN)
  assert.equal(out.nested.url, `https://user:${REDACTED_PASSWORD}@host/x`)
  assert.equal(out.count, 3)
  assert.equal(JSON.stringify(out), JSON.stringify(redactJson(JSON.parse(JSON.stringify(value)))))
})

test('non-string input passes through untouched', () => {
  assert.equal(redact(undefined), undefined)
  assert.equal(redact(null), null)
  assert.equal(redact(42), 42)
})
