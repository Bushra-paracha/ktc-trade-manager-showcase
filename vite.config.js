import { readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Lists every built file in dist/precache.json so the service worker can save
// the whole app on the device and open any page offline.
function precacheManifest() {
  let outDir = 'dist'
  return {
    name: 'ktc-precache-manifest',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir
    },
    closeBundle() {
      const files = []
      const walk = (dir) => {
        for (const name of readdirSync(dir)) {
          const path = join(dir, name)
          if (statSync(path).isDirectory()) walk(path)
          else files.push('/' + relative(outDir, path).split('\\').join('/'))
        }
      }
      walk(outDir)
      const precache = files.filter((f) => !/(service-worker\.js|precache\.json|\.map)$/.test(f) && !f.split('/').pop().startsWith('.'))
      writeFileSync(join(outDir, 'precache.json'), JSON.stringify({ version: Date.now(), files: precache }))
    },
  }
}

export default defineConfig({
  plugins: [react(), precacheManifest()],
  server: {
    host: true,
    port: 5173,
  },
})
