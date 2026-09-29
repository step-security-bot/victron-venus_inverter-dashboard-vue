// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'

it('keeps the spreadsheet facade and every Univer plugin on one core version', () => {
  const manifest = JSON.parse(
    readFileSync(resolve(import.meta.dirname, '../../package.json'), 'utf8')
  ) as { dependencies: Record<string, string> }
  const lock = JSON.parse(
    readFileSync(resolve(import.meta.dirname, '../../package-lock.json'), 'utf8')
  ) as { packages: Record<string, { version?: string }> }
  const version = manifest.dependencies['@univerjs/presets']
  const direct = Object.entries(manifest.dependencies).filter(([name]) =>
    name.startsWith('@univerjs/')
  )
  const installed = Object.entries(lock.packages).filter(([path]) =>
    // Icons are released separately and do not register core/facade plugins.
    /(?:^|\/)node_modules\/@univerjs\/(?!icons$)/.test(path)
  )

  expect(direct.length).toBeGreaterThan(1)
  expect(installed.length).toBeGreaterThan(direct.length)
  for (const [name, dependency] of direct) expect(dependency, name).toBe(version)
  for (const [path, dependency] of installed) {
    expect(dependency.version, path).toBe(version)
    // Nested cores have different facade prototypes, even at equal versions.
    expect(path, 'Univer must resolve to one shared plugin/core installation').toMatch(
      /^node_modules\/@univerjs\/[^/]+$/
    )
  }
})
