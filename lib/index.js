/**
 * dsh-github-skills — minimal bundle shim.
 *
 * This is the only code this package ships. It registers a read-only skill
 * provider on `ctx.skills` that serves the four SKILL.md bundles shipped
 * under `skills/` (github umbrella, gh-address-comments, gh-fix-ci,
 * gh-publish).
 *
 * Deliberate boundaries:
 * - It registers NO GitHub API tools.
 * - It manages NO credentials and performs NO network requests.
 * - It injects NO resident system prompt: skills appear in the catalog as
 *   name + description and load only when invoked (progressive disclosure).
 *
 * The provider follows the same contract as `@deepseek-ai/dsh-skill-filesystem`
 * (list/get with locator + resourceBase), so bundled skills behave like
 * filesystem skills: bodies are re-read on each `get()` and relative
 * `scripts/` references resolve against each skill's own directory.
 */

import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'dsh-github-skills'
export const inject = ['skills']

const SKILLS_DIR = fileURLToPath(new URL('../skills/', import.meta.url))
const PROVIDER_NAME = 'dsh-github-skills'
// Packaged skills rank below project/user/custom roots (100–500) so a user's
// own skill with the same name wins; matches the bundled rank used by
// @deepseek-ai/dsh-skill.
const PACK_RANK = 600
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const TRUE_FORMS = new Set(['true', 'yes', 'on', '1'])
const FALSE_FORMS = new Set(['false', 'no', 'off', '0'])

/** Parse a strict subset of YAML frontmatter used by this pack's SKILL.md files. */
function parseSkillText(text) {
  if (typeof text !== 'string' || !text.startsWith('---')) return undefined
  const firstNewline = text.indexOf('\n')
  if (firstNewline < 0) return undefined
  const closing = text.indexOf('\n---', firstNewline)
  if (closing < 0) return undefined
  const frontmatter = text.slice(firstNewline + 1, closing).trim()
  const body = text.slice(closing + 4).trim()
  const fields = Object.create(null)
  for (const rawLine of frontmatter.split('\n')) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) continue
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)
    if (match === null) continue
    fields[match[1]] = match[2].trim()
  }
  return { fields, body }
}

function scalar(value) {
  if (value === undefined) return undefined
  return value.replace(/^(["'])(.*)\1$/, '$2')
}

function parseBoolean(value) {
  const normalized = String(value).trim().toLowerCase()
  if (TRUE_FORMS.has(normalized)) return true
  if (FALSE_FORMS.has(normalized)) return false
  return undefined
}

function parseInvocation(fields) {
  const disabled = parseBoolean(fields['disable-model-invocation'])
  const userInvocable = parseBoolean(fields['user-invocable'])
  return {
    modelInvocable: disabled === undefined ? true : !disabled,
    userInvocable: userInvocable === undefined ? true : userInvocable,
  }
}

function parseMetadata(fields) {
  const metadata = {}
  for (const [key, value] of Object.entries(fields)) {
    if (['name', 'description', 'whenToUse', 'disable-model-invocation', 'user-invocable'].includes(key)) continue
    if (value === undefined) continue
    metadata[key] = value
  }
  return Object.keys(metadata).length === 0 ? undefined : metadata
}

class PackSkillProvider {
  constructor(ctx) {
    this.ctx = ctx
    this.name = PROVIDER_NAME
  }

  async list() {
    let entries
    try {
      entries = await readdir(SKILLS_DIR, { withFileTypes: true })
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return []
      throw error
    }
    const candidates = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const dir = join(SKILLS_DIR, entry.name)
      const skill = await this.readSkill(join(dir, 'SKILL.md'))
      if (skill === undefined) continue
      if (!SKILL_NAME.test(skill.name)) {
        this.ctx.logger?.warn?.(`dsh-github-skills: skill ${JSON.stringify(skill.name)} ignored: invalid skill name`)
        continue
      }
      candidates.push({
        name: skill.name,
        description: skill.description,
        ...(skill.whenToUse !== undefined ? { whenToUse: skill.whenToUse } : {}),
        invocation: skill.invocation,
        source: 'bundled',
        provider: PROVIDER_NAME,
        rank: PACK_RANK,
        locator: { dir },
        resourceBase: { kind: 'directory', path: dir },
        path: join(dir, 'SKILL.md'),
        ...(skill.metadata !== undefined ? { metadata: skill.metadata } : {}),
      })
    }
    return candidates
  }

  async get(candidate) {
    const locator = candidate?.locator
    if (locator === undefined || typeof locator.dir !== 'string') return undefined
    const skill = await this.readSkill(join(locator.dir, 'SKILL.md'))
    if (skill === undefined || skill.name !== candidate.name) return undefined
    return {
      name: skill.name,
      description: skill.description,
      ...(skill.whenToUse !== undefined ? { whenToUse: skill.whenToUse } : {}),
      invocation: skill.invocation,
      source: candidate.source,
      provider: candidate.provider,
      resourceBase: candidate.resourceBase,
      path: candidate.path,
      ...(skill.metadata !== undefined ? { metadata: skill.metadata } : {}),
      content: skill.body,
    }
  }

  async readSkill(file) {
    let raw
    try {
      raw = await readFile(file, 'utf8')
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return undefined
      throw error
    }
    const parsed = parseSkillText(raw)
    if (parsed === undefined) return undefined
    const { fields, body } = parsed
    const name = scalar(fields.name)
    const description = scalar(fields.description)
    if (name === undefined || description === undefined || name === '' || description === '') return undefined
    const whenToUse = scalar(fields.whenToUse)
    return {
      name,
      description,
      ...(whenToUse !== undefined ? { whenToUse } : {}),
      invocation: parseInvocation(fields),
      ...(parseMetadata(fields) !== undefined ? { metadata: parseMetadata(fields) } : {}),
      body,
    }
  }
}

export const apply = (ctx) => {
  ctx.skills.registerProvider(() => new PackSkillProvider(ctx))
}

// Parser helpers exported for tests and reuse.
export { parseSkillText, scalar, parseInvocation }

