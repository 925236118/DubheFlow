import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve('electron/main/index.ts') }
      }
    },
    resolve: {
      alias: {
        '@main': resolve('electron/main'),
        '@preload': resolve('electron/preload'),
        '@shared': resolve('shared')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve('electron/preload/index.ts') }
      }
    },
    resolve: {
      alias: {
        '@preload': resolve('electron/preload'),
        '@shared': resolve('shared')
      }
    }
  },
  renderer: {
    root: 'src',
    resolve: {
      alias: {
        '@renderer': resolve('src'),
        '@shared': resolve('shared')
      }
    },
    build: {
      rollupOptions: {
        input: { index: resolve('src/index.html') }
      }
    },
    plugins: [react()]
  }
})
