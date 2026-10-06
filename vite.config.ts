import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

// Common build configuration shared by both SPA and library builds
const commonBuildConfig = {
  rolldownOptions: {
    output: {
      codeSplitting: {
        groups: [
          { name: 'zrender-vendor', test: /\/node_modules\/zrender\// },
          { name: 'echarts-vendor', test: /\/node_modules\/(echarts|vue-echarts)\// },
        ],
      },
    },
  },
}

// SPA build configuration
const spaConfig = defineConfig({
  plugins: [vue(), tailwindcss()],
  base: '/',
  build: {
    ...commonBuildConfig,
    outDir: 'dist',
    rollupOptions: {
      input: resolve(__dirname, 'index.html'),
    },
  },
  server: {
    port: 5173,
    strictPort: false,
  },
})

// Library build configuration for reusable Vue components
const libConfig = defineConfig({
  publicDir: false,
  plugins: [vue(), tailwindcss()],
  base: './',
  build: {
    outDir: 'dist-lib',
    lib: {
      entry: resolve(__dirname, 'src/lib.ts'),
      name: 'VictronDashboard',
      formats: ['es'],
      fileName: (format) => `victron-dashboard.${format}.js`,
    },
    rollupOptions: {
      // Vue is a peer dependency - don't bundle it
      external: ['vue', 'vue-i18n', 'echarts', 'vue-echarts'],
      output: {
        format: 'es',
        // Emit chunk assets for dynamic imports in library mode
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.includes('style')) {
            return 'victron-dashboard.css'
          }
          return 'assets/[name]-[hash][extname]'
        },
      },
    },
    // CSS code splitting for library
    cssCodeSplit: true,
    sourcemap: true,
    minify: false, // Let consumers control minification
  },
  define: {
    __LIB_MODE__: 'true',
  },
})

// Export configuration based on mode
// Usage: vite build --config vite.config.ts --mode spa
//        vite build --config vite.config.ts --mode lib
export default defineConfig(({ mode }) => {
  if (mode === 'lib') {
    console.log('📦 Building library mode: exporting Vue components')
    return libConfig
  }
  console.log('🖥️  Building SPA mode: full dashboard application')
  return spaConfig
})
