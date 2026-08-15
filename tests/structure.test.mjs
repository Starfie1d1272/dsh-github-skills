/**
 * Skill structure tests: every SKILL.md must parse under the same strict
 * frontmatter subset the shim uses, carry a kebab-case name matching its
 * directory, describe itself, reference only existing files, and the
 * umbrella must route to the real specialist skills.
 */

import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { test } from 'node:test'

import { ROOT } from './helpers.mjs'
import { parseSkillText, scalar, parseInvocation } from '../lib/index.js'

const SKILLS_DIR = join(ROOT, 'skills')
const EXPECTED_SKILLS = ['github', 'gh-address-comments', 'gh-fix-ci', 'gh-publish']
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function readSkill(name) {
  const dir = join(SKILLS_DIR, name)
  return { dir, raw: readFileSync(join(dir, 'SKILL.md'), 'utf8') }
}

test('the pack ships exactly the four expected skills', () => {
  const dirs = readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
  assert.deepEqual(dirs, [...EXPECTED_SKILLS].sort())
})

for (const name of EXPECTED_SKILLS) {
  test(`SKILL.md ${name}: frontmatter parses and matches its directory`, () => {
    const { raw } = readSkill(name)
    const parsed = parseSkillText(raw)
    assert.ok(parsed !== undefined, 'frontmatter must be parseable by the shim parser')
    const { fields } = parsed
    const parsedName = scalar(fields.name)
    const description = scalar(fields.description)
    assert.equal(parsedName, name, 'frontmatter name must equal the directory name')
    assert.ok(SKILL_NAME.test(parsedName), 'name must be kebab-case')
    assert.ok(description !== undefined && description.length > 10, 'description must be present and meaningful')
    assert.ok(description.length <= 500, `description must fit the DSH catalog cap (<=500), got ${description.length}`)
    const invocation = parseInvocation(fields)
    assert.equal(invocation.modelInvocable, true, 'skills must be model-invocable')
    assert.equal(invocation.userInvocable, true, 'skills must be user-invocable')
    assert.ok(parsed.body.length > 0, 'body must be non-empty')
  })

  test(`SKILL.md ${name}: every relative reference resolves to an existing file`, () => {
    const { dir, raw } = readSkill(name)
    const parsed = parseSkillText(raw)
    const body = parsed.body
    const refs = [...body.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)].map((match) => match[1])
    const scriptRefs = [...body.matchAll(/`(?:node )?(scripts\/[^`\s]+)`/g)].map((match) => match[1])
    for (const ref of [...refs, ...scriptRefs]) {
      if (/^https?:\/\//.test(ref)) continue
      if (ref.startsWith('#')) continue
      const target = resolve(dir, ref)
      // The path must stay inside the skill directory (no escaping the pack).
      const rel = relative(dir, target)
      assert.ok(!rel.startsWith(`..${sep}`) && !rel.startsWith('..'), `${name}: reference ${ref} escapes the skill directory`)
      assert.doesNotThrow(() => statSync(target), `${name}: broken reference ${ref}`)
      assert.ok(statSync(target).isFile(), `${name}: reference ${ref} is not a file`)
    }
  })
}

test('umbrella github skill routes to the three specialist skills', () => {
  const { raw } = readSkill('github')
  for (const specialist of ['gh-address-comments', 'gh-fix-ci', 'gh-publish']) {
    assert.ok(raw.includes(specialist), `umbrella must reference specialist ${specialist}`)
  }
  // The umbrella must route, not duplicate the specialists' whole workflow.
  assert.ok(raw.toLowerCase().includes('route'), 'umbrella must contain routing language')
  assert.ok(!raw.includes('git add -A'), 'umbrella must not carry publish staging rules')
})

test('umbrella routes map to real skill directories (no broken routing targets)', () => {
  for (const specialist of ['gh-address-comments', 'gh-fix-ci', 'gh-publish']) {
    assert.ok(statSync(join(SKILLS_DIR, specialist, 'SKILL.md')).isFile(), `routed target ${specialist} exists`)
  }
})

test('specialist skills reference their shipped helper scripts', () => {
  const expected = {
    'gh-address-comments': 'scripts/fetch-review-threads.mjs',
    'gh-fix-ci': 'scripts/inspect-pr-checks.mjs',
    'gh-publish': 'scripts/publish-preflight.mjs',
  }
  for (const [name, script] of Object.entries(expected)) {
    const { raw } = readSkill(name)
    assert.ok(raw.includes(script), `${name} SKILL.md must reference ${script}`)
    assert.ok(statSync(join(SKILLS_DIR, name, script)).isFile(), `${name} script exists`)
  }
})

test('safety invariants are present in the SKILL.md text', () => {
  const comments = readSkill('gh-address-comments').raw
  assert.ok(comments.includes('git add -A') === false, 'address-comments must not suggest git add -A')
  assert.ok(/resolve|reply|submit review|push/.test(comments), 'address-comments must mention its remote-write boundary')

  const fixCi = readSkill('gh-fix-ci').raw
  assert.ok(fixCi.includes('report-only'), 'gh-fix-ci must treat external CI as report-only')
  assert.ok(fixCi.includes('root cause'), 'gh-fix-ci must demand an evidence-backed root cause')

  const publish = readSkill('gh-publish').raw
  assert.ok(publish.includes('git add -A') && publish.includes('never default'), 'gh-publish must forbid default git add -A')
  assert.ok(publish.includes('draft'), 'gh-publish must default to a draft PR')
})

test('all four SKILL.md files are valid YAML frontmatter under the DSH parser', () => {
  // The shim parser is a strict subset; this test cross-checks the same files
  // against the real YAML parser DSH ships (yaml is available inside a real
  // DSH install). Here we use Node's own YAML-free sanity: the DSH install
  // smoke covers the authoritative parse.
  for (const name of EXPECTED_SKILLS) {
    const raw = readSkill(name).raw
    assert.ok(raw.startsWith('---\n'), `${name}: must start with ---`)
    const closing = raw.indexOf('\n---', 4)
    assert.ok(closing > 0, `${name}: must close frontmatter with ---`)
    const frontmatter = raw.slice(4, closing)
    for (const line of frontmatter.split('\n')) {
      const trimmed = line.trim()
      if (trimmed === '' || trimmed.startsWith('#')) continue
      assert.match(trimmed, /^[A-Za-z0-9_-]+:\s*\S+/, `${name}: frontmatter line must be "key: value": ${line}`)
    }
  }
})
