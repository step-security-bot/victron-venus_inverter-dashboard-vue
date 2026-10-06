import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { createI18n } from 'vue-i18n'
import BatterySolarPanel from './BatterySolarPanel.vue'
import SidePanel from './SidePanel.vue'
import StatCards from './StatCards.vue'

describe('Cerbo measurements in dashboard tiles', () => {
  it('renders third phases and measured zero without inventing unknown battery or inverter state', () => {
    const view = mount(StatCards, { props: { gt: 0, g1: 100, g2: 200, g3: -300, t3: 450 } })
    expect(view.text()).toContain('0W')
    expect(view.text()).toContain('-300W')
    expect(view.text()).toContain('450W')
    expect(view.text()).toContain('—')
    expect(view.text()).not.toContain('0%')
    expect(view.text()).not.toContain('Bulk')
  })

  it('shows missing device measurements as unknown and true zero SoC as zero', async () => {
    const view = mount(BatterySolarPanel, {
      props: {
        showBatteries: true,
        showSolar: true,
        batteries: [{ name: 'BMS', state: 'Unknown' }],
        solarSources: [{ name: 'MPPT' }],
      },
    })
    expect(view.text()).toContain('BMS')
    expect(view.text()).not.toContain('0.00V')
    expect(view.text()).not.toContain('0.0%')
    await view.setProps({ batteries: [{ name: 'BMS', state: 'Idle', soc: 0, voltage: 48 }] })
    expect(view.text()).toContain('0.0%')
    expect(view.text()).toContain('48.00V')
    await view.setProps({ solarSources: [{ name: 'MPPT', pvVoltage: 0, current: 0, power: 0 }] })
    expect(view.text()).toContain('0.00V')
    expect(view.text()).toContain('0.0A')
  })

  it('shows tank percent and enables native water commands only with write capability', async () => {
    const view = mount(SidePanel, {
      global: {
        plugins: [
          createI18n({ legacy: false, locale: 'en', missingWarn: false, fallbackWarn: false }),
        ],
      },
      props: {
        waterLevel: 0.5,
        readOnly: true,
        evCharging: '',
        evPower: '',
        evPowerWatts: 0,
        evChargingKw: 0,
        evLoadPower: 0,
        pumpSwitchEntity: '',
        waterValveEntity: '',
        homeButtons: [],
        buttonStates: {},
        haSensors: [],
        haNumbers: [],
        haCovers: [],
        haMediaPlayers: [],
        haScenes: [],
        haWeather: null,
      },
    })
    expect(view.text()).toContain('0.5%')
    expect(view.text()).not.toContain('cm')
    expect(view.find('[aria-label="Pump manual mode"]').exists()).toBe(false)
    await view.setProps({
      readOnly: false,
      waterControlsAvailable: true,
      pumpMode: 1,
      waterValveMode: 2,
      pumpSwitch: true,
      waterValve: false,
    })
    await view.get('[aria-label="Pump manual mode"]').trigger('click')
    await view.get('[aria-label="Pump automatic mode"]').trigger('click')
    expect(view.emitted('send')).toEqual([
      ['water_mode', { which: 'pump', mode: 2 }],
      ['water_mode', { which: 'pump', mode: 0 }],
    ])
    const confirm = vi.fn().mockReturnValue(false)
    vi.stubGlobal('confirm', confirm)
    await view.get('[aria-label="Valve manual mode"]').trigger('click')
    expect(view.emitted('send')).toHaveLength(2)
    confirm.mockReturnValue(true)
    await view.get('[aria-label="Valve manual mode"]').trigger('click')
    expect(view.emitted('send')?.slice(-1)[0]).toEqual(['water_mode', { which: 'valve', mode: 1 }])
    vi.unstubAllGlobals()
  })
})

it('respects grid phase availability and expires submeter provenance without replacing primary readings', async () => {
  vi.useFakeTimers()
  const view = mount(StatCards, { props: { gt: 123, g1: 123, g2: 999, gridL2Available: false,
    gridBackup: { service: 'com.victronenergy.grid.backup', enabled: true, available: true, power: 60 },
    gridBackupObservedAt: Date.now() / 1000, gridUsingBackup: false } })
  expect(view.text()).not.toContain('999W')
  expect(view.text()).toContain('123W')
  expect(view.get('[data-testid="grid-backup"]').text()).toContain('60W')
  expect(view.get('[data-testid="grid-backup"]').attributes('title')).toContain('ready as backup')
  await vi.advanceTimersByTimeAsync(31000)
  expect(view.get('[data-testid="grid-backup"]').text()).toContain('—')
  expect(view.text()).toContain('123W')
  await view.setProps({ gridL1Available: false })
  expect(view.text()).not.toContain('123W')
  view.unmount()
  vi.useRealTimers()
})
