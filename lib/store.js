/**
 * Durable plugin state.
 *
 * Two small JSON documents live under `<DSH_HOME>/dsh-turbo/`: the per-session
 * speed choices and the capability verdicts earned by a probe. Both are plugin
 * memory, never a source of truth for the Harness: losing them only resets the
 * toggle to the profile default.
 *
 * @module dsh-turbo-mode/store
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Resolve the Harness home with the same precedence the Harness uses:
 * explicit config > non-blank `$DSH_HOME` > `~/.dsh`.
 * @param {string | undefined} configured
 * @param {Record<string, string | undefined>} [env]
 */
export function resolveDshHome(configured, env = process.env) {
  const fromEnv = typeof env.DSH_HOME === 'string' && env.DSH_HOME.trim() !== '' ? env.DSH_HOME : undefined
  const chosen = typeof configured === 'string' && configured.trim() !== '' ? configured : fromEnv
  return chosen === undefined ? join(homedir(), '.dsh') : chosen
}

/**
 * One directory of JSON documents with best-effort atomic writes.
 * @param {{ dir: string }} options
 */
export function createStore({ dir }) {
  /** @param {string} name */
  async function read(name) {
    try {
      const text = await readFile(join(dir, name), 'utf8')
      const value = JSON.parse(text)
      return value !== null && typeof value === 'object' ? value : {}
    } catch {
      return {}
    }
  }

  /**
   * @param {string} name
   * @param {unknown} value
   */
  async function write(name, value) {
    await mkdir(dir, { recursive: true })
    const target = join(dir, name)
    const temp = `${target}.${process.pid}.tmp`
    await writeFile(temp, `${JSON.stringify(value, undefined, 2)}\n`, 'utf8')
    await rename(temp, target)
  }

  return { dir, read, write }
}
