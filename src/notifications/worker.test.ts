import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const source = readFileSync('public/notifications-sw.js', 'utf8')
let database: IDBFactory
let shown: ReturnType<typeof vi.fn>
const now = Date.parse('2026-10-05T20:00:00Z')
const alarm = { schemaVersion: 1, kind: 'native', source: 'victron', eventKey: 'a'.repeat(64), sourceTimestampMs: now - 60_000, observedAtMs: now - 59_000, title: 'Low battery voltage', body: 'Quattro', url: '/' }
function worker() {
  const handlers = new Map<string, (event: unknown) => void>()
  const context = vm.createContext({
    indexedDB: database, IDBKeyRange, URL,
    Date: class extends Date { static now() { return now } },
    self: { location: { origin: 'https://dashboard.example' }, registration: { showNotification: shown }, addEventListener: (type: string, fn: (event: unknown) => void) => handlers.set(type, fn) },
  })
  vm.runInContext(source, context)
  const run = (code: string) => vm.runInContext(code, context)
  return { run, handlers }
}

beforeEach(() => { database = new IDBFactory(); shown = vi.fn().mockResolvedValue(undefined) })
describe('persistent notification worker', () => {
  it('persists Disable fencing across tabs, worker restart and stale Enable commits', async () => {
    const first = worker(); const second = worker()
    const beginning = await first.run("changeSettings({type:'notification-settings-begin',generation:0})")
    expect(beginning).toEqual({ enabled: false, generation: 1, applied: true })
    expect(await second.run("changeSettings({type:'notification-settings-set',enabled:false})"))
      .toEqual({ enabled: false, generation: 2, applied: true })
    const restarted = worker()
    expect(await restarted.run("changeSettings({type:'notification-settings-set',enabled:true,generation:1})"))
      .toEqual({ enabled: false, generation: 2, applied: false })
    expect(await restarted.run("changeSettings({type:'notification-settings-begin',generation:0})"))
      .toEqual({ enabled: false, generation: 2, applied: false })
    // An old client without the operation protocol also cannot undo Disable.
    expect((await first.run("changeSettings({type:'notification-settings-set',enabled:true})")).applied).toBe(false)
    await restarted.run(`deliver(${JSON.stringify(alarm)})`)
    expect(shown).not.toHaveBeenCalled()
    await restarted.run("changeSettings({type:'notification-settings-begin',generation:2})")
    expect(await restarted.run("changeSettings({type:'notification-settings-set',enabled:true,generation:3})"))
      .toEqual({ enabled: true, generation: 3, applied: true })
    await restarted.run(`deliver(${JSON.stringify(alarm)})`)
    expect(shown).toHaveBeenCalledTimes(1)
  })
  it('atomically admits only one Enable based on the same prior generation', async () => {
    const results = await Promise.all([worker(), worker()].map((w) => w.run("changeSettings({type:'notification-settings-begin',generation:0})")))
    expect(results.filter((result) => result.applied)).toHaveLength(1)
    expect(await worker().run('settings()')).toEqual({ enabled: false, generation: 1, applied: true })
  })
  it('checks Disable again after awaiting a delivery claim', async () => {
    const w = worker()
    await w.run(`settings(() => ({enabled:true,generation:1}))
      const claim = claimEvent
      claimEvent = async (event) => {
        const claimed = await claim(event)
        await changeSettings({type:'notification-settings-set',enabled:false})
        return claimed
      }`)
    expect(await w.run(`deliver(${JSON.stringify(alarm)})`)).toBe(false)
    expect(shown).not.toHaveBeenCalled()
  })
  it('has no application caching or fetch interception', () => {
    expect(worker().handlers.has('fetch')).toBe(false)
    expect(source).not.toContain('caches.')
  })
  it('deduplicates atomic concurrent tab deliveries and after worker restart', async () => {
    const first = worker(); const second = worker()
    await first.run("settings(() => ({enabled:true,generation:1}))")
    const command = `deliver(${JSON.stringify(alarm)})`
    await Promise.all([first.run(command), second.run(command)])
    await worker().run(command)
    expect(shown).toHaveBeenCalledTimes(1)
    expect(shown.mock.calls[0][1].timestamp).toBe(alarm.sourceTimestampMs)
    expect(shown.mock.calls[0][1].body).toContain('Event:')
    expect(shown.mock.calls[0][1].body).toContain('Quattro')
  })
  it('drops delayed historical events outside the server event TTL', async () => {
    const w = worker(); await w.run("settings(() => ({enabled:true,generation:1}))")
    await w.run(`deliver(${JSON.stringify({ ...alarm, sourceTimestampMs: now - 301_000 })})`)
    expect(shown).not.toHaveBeenCalled()
  })
  it('delivers distinct occurrences even if their titles match', async () => {
    const w = worker(); await w.run("settings(() => ({enabled:true,generation:1}))")
    await w.run(`deliver(${JSON.stringify(alarm)})`)
    await w.run(`deliver(${JSON.stringify({ ...alarm, eventKey: 'b'.repeat(64), sourceTimestampMs: now - 10_000 })})`)
    expect(shown).toHaveBeenCalledTimes(2)
  })
  it('fails closed when disabled, invalid or future event time, including push', async () => {
    const w = worker()
    await w.run(`deliver(${JSON.stringify(alarm)})`)
    await w.run("settings(() => ({enabled:true,generation:1}))")
    for (const event of [{ ...alarm, sourceTimestampMs: null }, { ...alarm, sourceTimestampMs: now + 31_000 }, { ...alarm, source: 'other' }, { ...alarm, url: 'https://foreign.example/' }, { ...alarm, eventKey: 'bad' }, { ...alarm, observedAtMs: now - 301_000 }]) {
      await w.run(`deliver(${JSON.stringify(event)})`)
    }
    expect(shown).not.toHaveBeenCalled()
  })
  it('accepts native inverter-control warnings with their system source', async () => {
    const w = worker(); await w.run("settings(() => ({enabled:true,generation:1}))")
    await w.run(`deliver(${JSON.stringify({ ...alarm, source: 'system' })})`)
    expect(shown).toHaveBeenCalledTimes(1)
  })
  it('accepts the server Unicode character bounds rather than UTF-16 unit counts', async () => {
    const w = worker(); await w.run("settings(() => ({enabled:true,generation:1}))")
    await w.run(`deliver(${JSON.stringify({ ...alarm, title: '🔋'.repeat(120), body: '🔋'.repeat(500) })})`)
    expect(shown).toHaveBeenCalledTimes(1)
    await w.run(`deliver(${JSON.stringify({ ...alarm, eventKey: 'c'.repeat(64), title: '🔋'.repeat(121) })})`)
    expect(shown).toHaveBeenCalledTimes(1)
  })
  it('does not consume an event if the OS rejects display', async () => {
    const w = worker(); await w.run("settings(() => ({enabled:true,generation:1}))")
    shown.mockRejectedValueOnce(new Error('denied'))
    await expect(w.run(`deliver(${JSON.stringify(alarm)})`)).rejects.toThrow()
    await w.run(`deliver(${JSON.stringify(alarm)})`)
    expect(shown).toHaveBeenCalledTimes(2)
  })
  it('settles a claim release and closes storage when the transaction aborts', async () => {
    const w = worker(); await w.run("settings(() => ({enabled:true,generation:1}))")
    await w.run(`claimEvent({key: '${alarm.eventKey}'})`)
    await w.run(`(async () => {
      const db = await openDatabase()
      const transaction = db.transaction.bind(db)
      const close = db.close.bind(db)
      globalThis.releaseClosed = false
      db.close = () => { globalThis.releaseClosed = true; close() }
      db.transaction = (...args) => {
        const tx = transaction(...args)
        Promise.resolve().then(() => tx.abort())
        return tx
      }
      openDatabase = async () => db
    })()`)
    await expect(w.run(`releaseClaim('${alarm.eventKey}')`)).rejects.toThrow('Notification storage unavailable')
    expect(w.run('releaseClosed')).toBe(true)
  })
  it('bounds dedupe storage while preserving recent claims', async () => {
    const w = worker(); await w.run("settings(() => ({enabled:true,generation:1}))")
    await w.run(`(async () => {
      const db = await openDatabase()
      await new Promise((resolve) => {
        const tx = db.transaction('events', 'readwrite')
        for (let i = 0; i < 4096; i++) tx.objectStore('events').put({ key: String(i), expires: Date.now() + i + 1 })
        tx.oncomplete = resolve
      }); db.close()
    })()`)
    await w.run(`deliver(${JSON.stringify(alarm)})`)
    const count = await w.run(`(async () => {
      const db = await openDatabase()
      const count = await new Promise((resolve) => {
        const tx = db.transaction('events', 'readonly'); const request = tx.objectStore('events').count()
        tx.oncomplete = () => resolve(request.result)
      }); db.close(); return count
    })()`)
    expect(count).toBe(4096)
    await worker().run(`deliver(${JSON.stringify(alarm)})`)
    expect(shown).toHaveBeenCalledTimes(1)
  })
  it('does not accept cross-origin worker configuration messages', () => {
    const w = worker(); const waitUntil = vi.fn()
    w.handlers.get('message')?.({ source: { url: 'https://foreign.example/' }, data: { type: 'notification-settings-set', enabled: true, delivery: 'push' }, waitUntil })
    expect(waitUntil).not.toHaveBeenCalled()
  })
})
