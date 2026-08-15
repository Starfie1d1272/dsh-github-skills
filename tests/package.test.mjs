/**
 * Package validation: npm pack produces a complete tarball, the installed
 * shim registers all four skills through the real provider contract, and
 * nothing outside the package's declared surface ships.
 */

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { test } from 'node:test'

import { ROOT, tempDir } from './helpers.mjs'

function pack() {
  const tmp = tempDir('dshg-pack')
  try {
    // --cache isolates from a possibly root-owned ~/.npm cache (EPERM).
    execFileSync('npm', ['pack', '--pack-destination', tmp.dir, '--cache', join(tmp.dir, '.npm-cache')], { cwd: ROOT, stdio: 'pipe' })
    const tarball = join(tmp.dir, readdirSync(tmp.dir).find((name) => name.endsWith('.tgz')))
    assert.ok(tarball.endsWith('.tgz'), 'npm pack produced a tarball')
    const files = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' }).trim().split('\n')
    return { tmp, tarball, files }
  } catch (error) {
    tmp.clean()
    throw error
  }
}

test('npm pack succeeds and contains every required path', () => {
  const { tmp, files } = pack()
  try {
    const required = [
      'package/package.json',
      'package/lib/index.js',
      'package/lib/redact.mjs',
      'package/cordis.patch.yml',
      'package/README.md',
      'package/README.zh-CN.md',
      'package/LICENSE',
      'package/THIRD_PARTY_NOTICES.md',
      'package/CHANGELOG.md',
      'package/references/capability-matrix.md',
      'package/references/upstream-notes.md',
      'package/references/safety-model.md',
      'package/skills/github/SKILL.md',
      'package/skills/gh-address-comments/SKILL.md',
      'package/skills/gh-address-comments/scripts/fetch-review-threads.mjs',
      'package/skills/gh-fix-ci/SKILL.md',
      'package/skills/gh-fix-ci/scripts/inspect-pr-checks.mjs',
      'package/skills/gh-publish/SKILL.md',
      'package/skills/gh-publish/scripts/publish-preflight.mjs',
    ]
    for (const path of required) {
      assert.ok(files.includes(path), `tarball missing ${path}`)
    }
    // The tarball must not leak dev/test/research material.
    for (const file of files) {
      assert.ok(!file.startsWith('package/tests/'), `tests must not ship: ${file}`)
      assert.ok(!file.startsWith('package/research/'), `research material must not ship: ${file}`)
      assert.ok(!file.includes('node_modules'), `node_modules must not ship: ${file}`)
    }
  } finally {
    tmp.clean()
  }
})

test('packed package.json declares the DSH bundle contract', () => {
  const { tmp, tarball } = pack()
  try {
    const manifest = JSON.parse(execFileSync('tar', ['-xOf', tarball, 'package/package.json'], { encoding: 'utf8' }))
    assert.equal(manifest.name, 'dsh-github-skills')
    assert.equal(manifest.version, '0.1.0')
    assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
    assert.equal(manifest.type, 'module')
    assert.equal(manifest.main, 'lib/index.js')
    assert.match(manifest.engines.node, /22\.19/)
    assert.equal(manifest.license, 'Apache-2.0')
  } finally {
    tmp.clean()
  }
})

test('installed tarball imports and registers the shim provider', async () => {
  const { tmp: packTmp, tarball } = pack()
  const tmp = tempDir('dshg-install')
  try {
    // Install into a disposable prefix: the real package resolution path
    // (node_modules/dsh-github-skills), never touching this repo or the
    // user's npm cache.
    execFileSync('npm', ['install', '--ignore-scripts', '--no-package-lock', '--no-save', '--prefix', tmp.dir, '--cache', join(tmp.dir, '.npm-cache'), tarball], {
      cwd: ROOT,
      stdio: 'pipe',
    })
    const moduleUrl = pathToFileURL(join(tmp.dir, 'node_modules/dsh-github-skills/lib/index.js')).href
    const mod = await import(moduleUrl)
    assert.equal(mod.name, 'dsh-github-skills')
    assert.deepEqual(mod.inject, ['skills'])
    assert.equal(typeof mod.apply, 'function')

    // Apply against a stub context capturing the registered provider.
    let captured
    const ctx = {
      skills: {
        registerProvider(factory) {
          captured = factory({ signal: new AbortController().signal, invalidate() {} })
        },
      },
      logger: { warn() {} },
    }
    mod.apply(ctx)
    assert.ok(captured, 'provider must be registered on apply')

    const candidates = await captured.list()
    assert.equal(candidates.length, 4)
    const names = candidates.map((candidate) => candidate.name).sort()
    assert.deepEqual(names, ['gh-address-comments', 'gh-fix-ci', 'gh-publish', 'github'])
    for (const candidate of candidates) {
      assert.match(candidate.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      assert.ok(candidate.description.length > 0)
      assert.equal(candidate.invocation.modelInvocable, true)
      assert.equal(candidate.source, 'bundled')
      assert.equal(candidate.resourceBase.kind, 'directory')
    }

    // Load one full body through the same path the registry uses.
    const github = candidates.find((candidate) => candidate.name === 'github')
    const definition = await captured.get(github)
    assert.equal(definition.name, 'github')
    assert.ok(definition.content.includes('# GitHub'))
    assert.ok(definition.content.includes('gh-address-comments'), 'umbrella body must route to specialists')
  } finally {
    packTmp.clean()
    tmp.clean()
  }
})

test('shim parser rejects malformed frontmatter without breaking the catalog', async () => {
  const mod = await import(pathToFileURL(join(ROOT, 'lib/index.js')).href)
  const { parseSkillText, scalar } = mod

  // No frontmatter at all.
  assert.equal(parseSkillText('just prose\n'), undefined)
  // Unclosed frontmatter.
  assert.equal(parseSkillText('---\nname: x\ndescription: y\n'), undefined)
  // Missing required keys.
  const missingDescription = parseSkillText('---\nname: foo\n---\n\nBody\n')
  assert.ok(missingDescription !== undefined)
  assert.equal(scalar(missingDescription.fields.description), undefined)
  // Valid minimal frontmatter with quoting.
  const valid = parseSkillText('---\nname: "quoted-name"\ndescription: \'A skill with "quotes" in it.\'\n---\n\nBody text.\n')
  assert.ok(valid !== undefined)
  assert.equal(scalar(valid.fields.name), 'quoted-name')
  assert.equal(scalar(valid.fields.description), 'A skill with "quotes" in it.')
  assert.equal(valid.body, 'Body text.')

  // A malformed bundle is skipped by the provider (list() keeps working).
  const tmp = tempDir('dshg-malformed')
  try {
    const { mkdirSync, writeFileSync } = await import('node:fs')
    mkdirSync(join(tmp.dir, 'skills/bad-skill'), { recursive: true })
    writeFileSync(join(tmp.dir, 'skills/bad-skill/SKILL.md'), 'no frontmatter here\n')
    let captured
    const ctx = {
      skills: {
        registerProvider(factory) {
          captured = factory({ signal: new AbortController().signal, invalidate() {} })
        },
      },
      logger: { warn() {} },
    }
    mod.apply(ctx)
    const candidates = await captured.list()
    assert.ok(candidates.length >= 4, 'malformed files must be skipped, valid skills must remain')
    assert.ok(!candidates.some((candidate) => candidate.name === 'bad-skill'), 'malformed skill must not appear')
  } finally {
    tmp.clean()
  }
})
