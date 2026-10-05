# inverter-dashboard-vue

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![CI](https://github.com/victron-venus/inverter-dashboard-vue/actions/workflows/ci.yml/badge.svg)](https://github.com/victron-venus/inverter-dashboard-vue/actions/workflows/ci.yml)
[![Vue.js](https://img.shields.io/badge/vue-3.x-green.svg)](https://vuejs.org/)
[![TypeScript](https://img.shields.io/badge/typescript-5.9-blue.svg)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/vite-8.x-646cff.svg)](https://vitejs.dev/)

Shared Vue 3 frontend SPA and reusable UI component library for Victron Venus ecosystem dashboards.

<!-- ci-release-process:start -->
## Release process

See the [release strategy](RELEASING.md) for validation, nightly, beta, RC and stable promotion rules, and the [operator runbook](docs/release-workflow.md) for local commands.
<!-- ci-release-process:end -->

## Overview

This project provides a modern, reactive web UI that can be embedded into multiple backend implementations:

| Backend | Technology | Repository |
|---------|------------|------------|
| [inverter-dashboard](https://github.com/victron-venus/inverter-dashboard) | Python / FastAPI | Docker, NAS |
| [inverter-dashboard-go](https://github.com/victron-venus/inverter-dashboard-go) | Go / MQTT | Cerbo GX |

The Vue SPA (`dist/`) can be served by any backend that provides MQTT data via WebSocket.

---

## Project Role

**Shared Vue 3 component library used by inverter-desktop and available for custom dashboard builds.** Includes ECharts widgets, MQTT hooks, Tailwind UI components.

| Use Case | Recommended |
|----------|-------------|
| Cerbo GX / embedded | [inverter-dashboard-go](https://github.com/victron-venus/inverter-dashboard-go) — single binary, minimal footprint |
| Docker / NAS | [inverter-dashboard](https://github.com/victron-venus/inverter-dashboard) — Python/FastAPI (`alvit/inverter-dashboard`) |
| Native desktop/mobile | [inverter-desktop](https://github.com/victron-venus/inverter-desktop) — Rust/Tauri app with offline support |
| Building custom dashboards | **inverter-dashboard-vue** (this) — shared Vue 3 component library |

## Consumers

This repository is the shared SPA / component library consumed by:

- **[inverter-desktop](https://github.com/victron-venus/inverter-desktop)** — Tauri desktop/mobile app bundles the built SPA (`dist/`) via Tauri's webview and uses exported Vue components from `build.lib/`.
- **[inverter-dashboard](https://github.com/victron-venus/inverter-dashboard)** — Python/FastAPI dashboard mounts `dist/` as static files.
- **[inverter-dashboard-go](https://github.com/victron-venus/inverter-dashboard-go)** — Go/MQTT binary embeds `dist/` via `//go:embed` and serves the SPA.

Build artifacts consumed by downstream projects:
- `dist/` — production SPA bundle (HTML/JS/CSS)
- `build.lib/` — Vue component library for embedding in custom dashboards

Updates flow: changes here → PR → CI builds `dist/` + `build.lib/` → consumers pull updated artifacts via release tags or submodule sync.

## Features

- **Real-time dashboard** with live MQTT data via WebSocket
- **Interactive ECharts** charts for solar, battery, and grid data
- **Multi-language support**: English, German, Dutch, French, Ukrainian
- **Responsive design** with Tailwind CSS v4
- **Mobile-friendly** viewport and touch support

## Keyboard access

Use Tab to reach section headers and notification entries, then Enter or Space to expand a section or mark a notification as read. Settings and camera popups keep keyboard focus inside the open dialog; press Escape or activate the labelled close button to dismiss them and return to the opener. Public mode continues to hide command controls.

## Tech Stack

- Vue 3 (Composition API + `<script setup>`)
- TypeScript 5.9.3 (pinned for the JavaScript compiler API used by `vue-tsc`)
- Vite 8 (with Library Mode for component exports)
- Tailwind CSS v4
- ECharts (via vue-echarts)
- vue-i18n for localization
- Vitest for unit testing

ESS status, the seven inverter-control header flags, and EV discovery work with
either backend's direct Cerbo MQTT or IGW source without Home Assistant. Unknown
states remain unavailable, measured EV zero remains visible, and controller
writes require a live command connection. See the
[controller and EV contract](docs/controller-contract.md) for fields and commands.
The locked TypeScript 5.9.3 dependency keeps `vue-tsc` checks functional; TypeScript
7's native compiler no longer exposes the JavaScript compiler entry point that
the current `vue-tsc` uses.

## Scripts

```bash
# Development
npm run dev          # Start dev server

# Build
npm run build:spa    # Build SPA (dist/)
npm run build:lib    # Build component library (build.lib/)
npm run build:all     # Build both

# Testing
npm run test         # Run tests once
npm run test:watch   # Watch mode
npm run test:coverage # With coverage

# Type checking
npm run typecheck    # TypeScript check

# Linting (Biome)
npm run lint         # Lint all source files
npm run lint:fix     # Lint and auto-fix
```

## Architecture

```
src/
├── components/       # Vue components (BatterySolarPanel, SidePanel, etc.)
├── composables/     # Composables (useMqtt, useChart, useConnection, useHA)
├── i18n/            # Translations (en, de, nl, fr, uk)
├── types/           # TypeScript types
├── App.vue          # Main application
└── static/         # Static assets (dist/ after build)
```

### Component Hierarchy

```
App.vue
├── AppHeader.vue
├── ChartPanel.vue
│   ├── LineChart.ts (ECharts wrapper)
│   └── DailyStats.vue
├── SidePanel.vue
│   ├── BatteryDisplay.vue
│   ├── LoadsTable.vue
│   └── StatusBar.vue
└── ConsoleLog.vue
```

## Embedding

### inverter-dashboard (Python)

The compiled `dist/` is mounted at `/static`:

```python
from fastapi.staticfiles import StaticFiles

app.mount("/static", StaticFiles(directory="inverter_dashboard/static/dist"))
```

### inverter-dashboard-go (Go)

The `dist/` is embedded via `//go:embed`:

```go
//go:embed internal/html/vue-ui
var vueFS embed.FS
```

## i18n

Translations are in `src/i18n/`. To add a new language:

1. Create `src/i18n/{lang}.ts`
2. Export a messages object
3. Add to `src/i18n/index.ts`

## Testing

```bash
npm run test          # Run all tests
npm run test:watch     # Watch for changes
npm run test:coverage  # Generate coverage report
```

Test files use Vitest + @vue/test-utils + Happy DOM.

## CI/CD

- **Lint**: `npm run lint` (Biome)
- **TypeScript check**: `npm run typecheck`
- **Tests**: `npm run test`
- **Build**: `npm run build:all`
- **Release**: Qualified RC artifacts are promoted through the [release process](RELEASING.md).

## Completed Features

- ✅ **Dual Build Targets**: Vite config supports both SPA build (`dist/`) and library mode (`build.lib/`) for reusable Vue components
- ✅ **Automated Asset Export**: `scripts/export_dist.sh` compiles Vue assets and copies to `inverter-dashboard-go/internal/html/vue-ui` and `inverter-dashboard/src/inverter_dashboard/static`
- ✅ **Vitest Unit Test Suite**: Tests for composables (`useMqtt`, `useChart`, `useConnection`, `useHA`) and components (`BatterySolarPanel`, `SidePanel`)
- ✅ **i18n Localization Expansion**: Complete translations for English, German, Dutch, French, Ukrainian
- ✅ **CI & Package Publishing**: Candidate builds and verified promotion use `.github/workflows/release-pipeline.yml`.

## Related Projects

- [inverter-control](https://github.com/victron-venus/inverter-control) - Victron ESS Grid-Zero Controller
- [inverter-desktop](https://github.com/victron-venus/inverter-desktop) - Tauri Desktop App
- [inverter-monitoring](https://github.com/victron-venus/inverter-monitoring) - Telegraf/InfluxDB/Grafana Stack
- [dbus-mqtt-battery](https://github.com/victron-venus/dbus-mqtt-battery) - JBD BMS to D-Bus Bridge



## Public / here.now mode

Read-only hosting (e.g. [here.now](https://here.now)) can drive tiles from **inverter-gateway** without the Python/Go MQTT backend and without an injected `public-adapter.js`.

Enable any of:

1. Build: `VITE_PUBLIC_MODE=true npm run build:spa`
2. HTML meta: `<meta name="inverter-public-mode" content="true" />`
3. Runtime: `window.__INVERTER_PUBLIC__ = true`

Snapshot URL defaults to same-origin `/api/gateway/snapshot` (override with `VITE_GATEWAY_SNAPSHOT_PATH` or meta `inverter-gateway-snapshot`). Optional `VITE_API_BASE` prefixes API paths.

Proxy that path to gateway `GET /v1/snapshot` (plus health). Writes / WebSocket MQTT are disabled in public mode; the SPA polls the snapshot every ~3s. The connection indicator turns offline after 15 seconds without a valid telemetry snapshot, including HTTP failures, invalid responses, and stalled requests. Last-known tiles remain visible while offline; the next valid snapshot restores the live indicator. Requests time out after 10 seconds so polling can recover.

The browser talks to the dashboard backend or a snapshot proxy; it must never
contain IGW bearer tokens or Cloudflare Access service credentials. Configure the
LAN backend/proxy with `GATEWAY_URL=https://gateway.example.com:9151`, using the
hostname covered by the IGW certificate. Cloud-hosted proxies must use the public
HTTPS gateway URL reachable from their hosting environment. Keep certificate
verification enabled and disable upstream redirects in the proxy.

Public snapshot requests reject redirects. `VITE_GATEWAY_SNAPSHOT_PATH` remains a
route such as `/api/gateway/snapshot`; use an HTTPS `VITE_API_BASE` for a remote
proxy. Relative same-origin routes remain supported, including local development.
HTTP remote proxy URLs, URL credentials, and protocol-relative URLs are rejected.

## License

MIT

## Cerbo telemetry contract

The Python and Go backends serve the same complete state over WebSocket and
`/api/state`. HTTP fallback replaces the previous snapshot, including removed
devices. Embedded SPA assets in both backends are built from this source.

- `g1`/`g2`/`g3` and `t1`/`t2`/`t3` are phase powers in W; totals include all
  available phases. Battery SoC is measured, never inferred from pack voltage.
- `telemetry_available[field] = false` means unknown, even if a typed backend
  serializes a numeric zero. Device entries can carry the same availability map.
  The UI preserves measured zero and renders unavailable readings as a dash.
- `mqtt_connected`, or `gateway_connected` when `data_source` is `igw`, describes
  the upstream connection. Receipt of a WebSocket frame alone is not proof that
  Cerbo is connected. Missing power readings create gaps in chart history.
- `ev_power` is vehicle power in W; `ev_charging_kw` is charger power in kW.
  `water_level` is the Victron tank percentage, including readings below 1%.
- Water overrides use `water_mode` with `which: "pump" | "valve"` and
  `mode: 0 | 1 | 2` (auto/on/off). They require `water_controls_available`, a
  known Mode on the configured device, and readback from Cerbo. Public and
  gateway-only views cannot issue water overrides.
- Control flags, daily statistics and forecasts remain controller-owned.
  Appliance states and configured rich Home Assistant controls use the direct
  HA integration; HA overlays cannot replace native Cerbo measurements.

Build with `npm ci`, then `npm run build` and `npm test`. The checked-in backend
assets must be refreshed from this `dist/` when changing the wire contract.

## Notification event time

Native notifications use the source event's `ts` (RFC3339 with a timezone), not
when the browser received a replay. Banner ages refresh every 15 seconds and on
focus/visibility changes. Hovering the age shows the full local date, time and
timezone. Missing or invalid times stay unavailable; a future source time is
shown as an absolute date rather than “just now”.

History keeps up to 100 entries. A late timestamp completes the existing entry
without changing its read status. Replay suppression remembers the last 4096
observed event identities (ID and source timestamp) in the current tab, including
cleared entries. Older identities can appear again after that bounded window or
a page reload; timestamps are not assumed to be monotonic. An unknown-time entry
that was cleared can reappear once its source timestamp first becomes known.

## Electricity tariffs

The daily strip includes a weekly Univer tariff editor with Emporia reference
import and local persistence. See [tariff editing](docs/electricity-tariffs.md).

Tariffs can also be entered during SetupHelper configuration or first-run desktop
setup and provisioned with deployment files. Seasons and billing start dates
survive configuration backups and updates. See [installation defaults and tariff
configuration](docs/electricity-tariffs.md#installation-defaults-and-configuration-backups).
