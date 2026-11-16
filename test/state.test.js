import test from 'node:test'
import assert from 'node:assert/strict'

import { createState, isSpeed } from '../lib/state.js'

/** In-memory stand-in for the on-disk store. */
function memoryStore(initial = {}) {
  const files = { ...initial }
  return {
    dir: 'memory',
    files,
    async read(name) {
      return files[name] ?? {}
    },
    async write(name, value) {
      files[name] = JSON.parse(JSON.stringify(value))
    },
  }
}

test('isSpeed rejects anything the plugin would not persist', () => {
  assert.equal(isSpeed('standard'), true)
  assert.equal(isSpeed('fast'), true)
  assert.equal(isSpeed('FAST'), false)
  assert.equal(isSpeed('turbo'), false)
  assert.equal(isSpeed(undefined), false)
})

test('a fresh profile starts at the configured default', async () => {
  const state = createState({ store: memoryStore(), defaultSpeed: 'standard' })
  await state.load()
  assert.equal(state.speedFor('session-a'), 'standard')
  assert.equal(state.speedFor(undefined), 'standard')
})

test('a per-session choice does not leak into other sessions', async () => {
  const state = createState({ store: memoryStore(), defaultSpeed: 'standard' })
  await state.load()
  await state.setSpeed('session-a', 'fast')
  assert.equal(state.speedFor('session-a'), 'fast')
  assert.equal(state.speedFor('session-b'), 'standard')
  assert.equal(state.speedFor(undefined), 'standard')
})

test('the global choice moves the default and unknown sessions with it', async () => {
  const state = createState({ store: memoryStore(), defaultSpeed: 'standard' })
  await state.load()
  await state.setSpeed('global', 'fast')
  assert.equal(state.speedFor('never-seen'), 'fast')
  assert.equal(state.speedFor(undefined), 'fast')
  assert.equal(state.defaultSpeed, 'fast')
})

test('choices survive a reload through the same store', async () => {
  const store = memoryStore()
  const first = createState({ store, defaultSpeed: 'standard' })
  await first.load()
  await first.setSpeed('session-a', 'fast')
  await first.setSpeed('global', 'fast')

  const reloaded = createState({ store, defaultSpeed: 'standard' })
  await reloaded.load()
  assert.equal(reloaded.speedFor('session-a'), 'fast')
  assert.equal(reloaded.defaultSpeed, 'fast')
  assert.equal(store.files['state.json'].version, 1)
})

test('a corrupt or hostile saved state is ignored rather than trusted', async () => {
  const store = memoryStore({
    'state.json': { defaultSpeed: 'warp', sessions: { a: 'fast', b: 42, '': 'fast' } },
  })
  const state = createState({ store, defaultSpeed: 'standard' })
  await state.load()
  assert.equal(state.defaultSpeed, 'standard')
  assert.equal(state.speedFor('a'), 'fast')
  assert.equal(state.speedFor('b'), 'standard')
})

test('an unknown speed is refused before it reaches the disk', async () => {
  const store = memoryStore()
  const state = createState({ store, defaultSpeed: 'standard' })
  await state.load()
  await assert.rejects(() => state.setSpeed('session-a', 'warp'), /unknown speed/)
  assert.equal(store.files['state.json'], undefined)
})

test('describe reports what the panel shows', async () => {
  const state = createState({ store: memoryStore(), defaultSpeed: 'standard' })
  await state.load()
  await state.setSpeed('session-a', 'fast')
  const described = state.describe()
  assert.deepEqual(described.speeds, ['standard', 'fast'])
  assert.equal(described.defaultSpeed, 'standard')
  assert.equal(described.sessionCount, 1)
  assert.deepEqual(described.sessions, { 'session-a': 'fast' })
})
