/**
 * Per-session speed, remembered across restarts.
 *
 * A choice is keyed by Harness session id, so every conversation keeps its own
 * speed. `defaultSpeed` from the profile patch answers for sessions that never
 * chose.
 *
 * @module dsh-turbo-mode/state
 */

import { SPEEDS } from './capability.js'

/** Keep the file small; a profile has far fewer live sessions than this. */
const MAX_SESSIONS = 500

const FILE = 'state.json'

/**
 * @param {unknown} value
 * @returns {value is 'standard' | 'fast'}
 */
export function isSpeed(value) {
  return value === 'standard' || value === 'fast'
}

/**
 * @param {object} options
 * @param {ReturnType<import('./store.js').createStore>} options.store
 * @param {'standard' | 'fast'} options.defaultSpeed
 */
export function createState({ store, defaultSpeed }) {
  /** @type {Map<string, 'standard' | 'fast'>} */
  const sessions = new Map()
  let seeded = /** @type {'standard' | 'fast'} */ (isSpeed(defaultSpeed) ? defaultSpeed : 'standard')
  let loaded = false

  async function load() {
    if (loaded) return
    loaded = true
    const saved = await store.read(FILE)
    if (isSpeed(saved.defaultSpeed)) seeded = saved.defaultSpeed
    const savedSessions = saved.sessions
    if (savedSessions !== null && typeof savedSessions === 'object') {
      for (const [id, speed] of Object.entries(savedSessions)) {
        if (typeof id === 'string' && isSpeed(speed)) sessions.set(id, speed)
      }
    }
  }

  async function persist() {
    /** @type {Record<string, string>} */
    const flat = {}
    const entries = [...sessions.entries()].slice(-MAX_SESSIONS)
    for (const [id, speed] of entries) flat[id] = speed
    await store.write(FILE, { version: 1, defaultSpeed: seeded, sessions: flat })
  }

  /** @param {string | undefined} sessionId */
  function speedFor(sessionId) {
    if (typeof sessionId === 'string' && sessions.has(sessionId)) return sessions.get(sessionId)
    return seeded
  }

  /**
   * @param {string | undefined} sessionId - omitted or `'global'` writes the default.
   * @param {'standard' | 'fast'} speed
   */
  async function setSpeed(sessionId, speed) {
    if (!isSpeed(speed)) throw new Error(`unknown speed: ${String(speed)}`)
    if (typeof sessionId !== 'string' || sessionId === '' || sessionId === 'global') {
      seeded = speed
    } else {
      sessions.set(sessionId, speed)
    }
    await persist()
    return speed
  }

  function describe() {
    /** @type {Record<string, string>} */
    const flat = {}
    for (const [id, speed] of sessions) flat[id] = speed
    return {
      defaultSpeed: seeded,
      speeds: [...SPEEDS],
      sessions: flat,
      sessionCount: sessions.size,
    }
  }

  return { load, persist, speedFor, setSpeed, describe, get defaultSpeed() { return seeded } }
}
