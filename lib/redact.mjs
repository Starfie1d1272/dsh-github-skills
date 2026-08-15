/**
 * Shared conservative credential redaction for model-visible output.
 *
 * This pack never extracts raw credentials, but *untrusted remote content*
 * (PR comments, review thread bodies, CI logs) and diagnostics (gh/git
 * stderr, remote URLs) can carry secret-like material a user or a third
 * party pasted. Before any helper output reaches stdout/stderr, every known
 * credential-bearing shape is replaced with a stable placeholder.
 *
 * Coverage:
 *   - GitHub token prefixes: ghp_ gho_ ghu_ ghs_ ghr_ github_pat_
 *   - URL userinfo passwords in https/http remotes:
 *       https://user:TOKEN@host/... -> https://user:[REDACTED_PASSWORD]@host/...
 *       https://TOKEN@host/...      -> https://[REDACTED_CREDENTIAL]@host/...
 *   - ssh://git@host: and git@host: forms are left untouched (the `git`
 *     username is not a secret and must not be mangled)
 *
 * The redaction is deliberately narrow: ordinary prose is never
 * rewritten, only credential-shaped tokens.
 */

export const REDACTED_TOKEN = '[REDACTED_GITHUB_TOKEN]'
export const REDACTED_PASSWORD = '[REDACTED_PASSWORD]'
export const REDACTED_CREDENTIAL = '[REDACTED_CREDENTIAL]'

// https://user:password@host or https://token@host — handled in ONE pass so a
// redacted password is never re-matched by a second rule.
const URL_USERINFO = /(https?:\/\/)([^/@\s]+)@/g
// GitHub token-shaped strings (ghp_ gho_ ghu_ ghs_ ghr_ github_pat_).
const GITHUB_TOKEN = /(?:gh[pousr]_[A-Za-z0-9]{12,}|github_pat_[A-Za-z0-9_]{12,})/g

/** Replace credential-shaped material in a string with stable placeholders. */
export function redact(input) {
  if (typeof input !== 'string') return input
  let out = input
  out = out.replace(URL_USERINFO, (match, scheme, userinfo) => {
    const separator = userinfo.indexOf(':')
    if (separator >= 0) {
      // Keep the username (e.g. git, oauth2), redact the password.
      return `${scheme}${userinfo.slice(0, separator)}:${REDACTED_PASSWORD}@`
    }
    // The whole userinfo is credential material (https://TOKEN@host).
    return `${scheme}${REDACTED_CREDENTIAL}@`
  })
  out = out.replace(GITHUB_TOKEN, REDACTED_TOKEN)
  return out
}

/** Redact every string in a JSON-compatible value (recursively). */
export function redactJson(value) {
  if (typeof value === 'string') return redact(value)
  if (Array.isArray(value)) return value.map(redactJson)
  if (value !== null && typeof value === 'object') {
    const out = {}
    for (const [key, child] of Object.entries(value)) out[key] = redactJson(child)
    return out
  }
  return value
}
