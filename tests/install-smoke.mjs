#!/usr/bin/env node
/**
 * install-smoke.mjs — end-to-end disposable-profile install verification.
 *
 * Exercises the REAL install path against a freshly created, disposable DSH
 * home (never the user's ~/.dsh):
 *
 *   1. npm pack the package into a temp dir
 *   2. `dsh plugin --profile smoke add <tarball>` (real pnpm install path)
 *   3. `dsh --profile smoke --dump-config` shows the shim row mounted
 *   4. programmatic boot of the composed profile using the real
 *      @deepseek-ai/dsh-app-boot from the installed DSH, then
 *      `ctx.skills.list()` and `ctx.skills.get('github')` through the real
 *      registry — proving the four skills are discoverable and loadable
 *   5. teardown: remove the disposable home
 *
 * Exit 0 on success, non-zero on any failure. Prints a JSON summary.
 *
 * Requirements: `dsh` on PATH (or DSH_BIN), `pnpm` on PATH, `node >= 22.19`.
 * No GitHub credentials are needed.
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const EXPECTED_SKILLS = ['github', 'gh-address-comments', 'gh-fix-ci', 'gh-publish']

function locateDshInstall() {
  const fromEnv = process.env.DSH_BIN
  const bin = fromEnv ?? (() => {
    const which = spawnSync('which', ['dsh'], { encoding: 'utf8' })
    if (which.status !== 0) return undefined
    return which.stdout.trim()
  })()
  if (bin === undefined || bin === '') {
    throw new Error('dsh not found on PATH (set DSH_BIN to the dsh executable)')
  }
  // Walk up from the resolved bin until we find the @deepseek-ai/dsh package.
  let dir = dirname(realpathSync(bin))
  for (let depth = 0; depth < 6; depth += 1) {
    const manifestPath = join(dir, 'package.json')
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      if (manifest.name === '@deepseek-ai/dsh') {
        return { packageDir: dir, bin }
      }
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error(`could not locate the @deepseek-ai/dsh package from dsh bin ${bin}`)
}

async function main() {
  const home = mkdtempSync(join(tmpdir(), 'dshg-smoke-home-'))
  const work = mkdtempSync(join(tmpdir(), 'dshg-smoke-work-'))
  const results = {}
  let ctx = undefined
  try {
    const { packageDir, bin } = locateDshInstall()
    results.dshInstall = packageDir
    const installAnchor = join(packageDir, 'package.json')
    const appBootRoot = join(packageDir, 'node_modules')

    // 1. pack (isolated --cache: the user's ~/.npm cache may be root-owned)
    execFileSync('npm', ['pack', '--pack-destination', work, '--cache', join(work, '.npm-cache')], { cwd: ROOT, stdio: 'pipe' })
    const tarball = join(work, readdirSync(work).find((name) => name.endsWith('.tgz')))
    if (!tarball.endsWith('.tgz')) throw new Error('npm pack produced no tarball')
    results.tarball = tarball

    // 2. real install into a disposable profile
    const install = spawnSync(bin, ['plugin', '--profile', 'smoke', 'add', tarball], {
      encoding: 'utf8',
      env: { ...process.env, DSH_HOME: home },
      timeout: 300_000,
    })
    if (install.status !== 0) {
      throw new Error(`dsh plugin add failed\nstdout: ${install.stdout}\nstderr: ${install.stderr}`)
    }
    results.install = 'ok'

    // 3. dump-config shows the shim row
    const dump = spawnSync(bin, ['--profile', 'smoke', '--dump-config'], {
      encoding: 'utf8',
      env: { ...process.env, DSH_HOME: home },
      timeout: 120_000,
    })
    if (dump.status !== 0) {
      throw new Error(`dsh --dump-config failed: ${dump.stderr}`)
    }
    if (!dump.stdout.includes('dsh-github-skills')) {
      throw new Error('--dump-config does not contain the dsh-github-skills row')
    }
    results.dumpConfig = 'contains dsh-github-skills row'

    // 4. boot probe against the real registry
    process.env.DSH_HOME = home
    const appBoot = await import(pathToFileURL(join(appBootRoot, '@deepseek-ai/dsh-app-boot/lib/index.js')).href)
    const launchEnv = await import(pathToFileURL(join(appBootRoot, '@deepseek-ai/dsh-launch-environment/lib/index.js')).href)
    const cmdline = await import(pathToFileURL(join(appBootRoot, '@deepseek-ai/dsh-cmdline/lib/index.js')).href)

    appBoot.healProfilesModuleFallback(installAnchor, home)
    const profile = appBoot.loadProfile('dsh', 'smoke', installAnchor, home)
    const bundlePatches = profile.layers.flatMap((layer) => layer.patches)
    const homePatches = appBoot.loadOptionalPatches('dsh', join(home, appBoot.PROFILE_PATCH_FILENAME)) ?? []
    const rootConfig = join(profile.dir, 'cordis.yml')
    const allPatches = [...bundlePatches, ...homePatches]

    const environment = launchEnv.createLaunchEnvironmentSnapshot([{ source: 'process', values: { ...process.env } }])
    ctx = await appBoot.boot('dsh', rootConfig, structuredClone(allPatches), (hostCtx) => {
      hostCtx.provide(launchEnv.DSH_LAUNCH_ENVIRONMENT_KEY, environment)
      cmdline.provideCmdline(hostCtx, { args: [], exit: (code) => { process.exitCode = code } })
    })

    const skills = await ctx.skills.list({})
    const names = skills.map((skill) => skill.name).sort()
    for (const expected of EXPECTED_SKILLS) {
      if (!names.includes(expected)) {
        throw new Error(`skill ${expected} missing from the discovered catalog (have: ${names.join(', ')})`)
      }
    }
    results.discovered = EXPECTED_SKILLS

    const github = await ctx.skills.get('github', {})
    if (github === undefined) throw new Error('ctx.skills.get("github") returned undefined')
    if (!github.content.includes('# GitHub')) throw new Error('loaded github skill body is unexpected')
    if (github.resourceBase?.kind !== 'directory') throw new Error('github skill resourceBase must be a directory')
    results.loaded = 'github body loaded with directory resourceBase'

    // The model-facing catalog only carries summaries (progressive disclosure).
    const summary = skills.find((skill) => skill.name === 'github')
    if (summary.description.length === 0 || summary.content !== undefined) {
      throw new Error('catalog summaries must carry name+description only')
    }
    results.progressiveDisclosure = 'catalog carries summaries only'

    // 5. dispose the booted tree, then verify uninstall leaves a clean profile
    await ctx.fiber.dispose().catch(() => {})
    ctx = undefined
    const remove = spawnSync(bin, ['plugin', '--profile', 'smoke', 'remove', 'dsh-github-skills'], {
      encoding: 'utf8',
      env: { ...process.env, DSH_HOME: home },
      timeout: 300_000,
    })
    if (remove.status !== 0) {
      throw new Error(`dsh plugin remove failed\nstdout: ${remove.stdout}\nstderr: ${remove.stderr}`)
    }
    const manifestAfter = JSON.parse(readFileSync(join(home, 'profiles/smoke/package.json'), 'utf8'))
    if ((manifestAfter.dsh?.profile?.bundles ?? []).includes('dsh-github-skills')) {
      throw new Error('dsh-github-skills still listed in dsh.profile.bundles after removal')
    }
    // pnpm leaves its own bookkeeping (dotfiles/.pnpm) behind; the contract
    // is that no package directories remain and the bundle layer is gone.
    const leftover = readdirSync(join(home, 'profiles/smoke/node_modules'))
    const packageLeftovers = leftover.filter((name) => !name.startsWith('.'))
    if (packageLeftovers.length > 0) {
      throw new Error(`profile node_modules still contains packages after removal: ${packageLeftovers.join(', ')}`)
    }
    results.uninstall = `bundles reconciled; node_modules only pnpm bookkeeping (${leftover.length} entries)`

    results.status = 'passed'
  } catch (error) {
    results.status = 'failed'
    process.stderr.write(`install-smoke: FAIL: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`)
    process.exitCode = 1
  } finally {
    if (ctx !== undefined) {
      await ctx.fiber.dispose().catch(() => {})
    }
    rmSync(home, { recursive: true, force: true })
    rmSync(work, { recursive: true, force: true })
  }
  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`)
}

main().catch((error) => {
  process.stderr.write(`install-smoke: fatal: ${error.stack ?? error}\n`)
  process.exit(1)
})
