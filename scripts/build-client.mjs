// Client bundle build (S4 R1): esbuild -> the DSH client closure-factory
// shape (window.__ModuleLoader__.load({id, factory})). The loader id and output
// path come from package.json, so a package rename fails at build time rather
// than registering the bundle under a stale id.
import { readFileSync } from 'node:fs'
import { build } from 'esbuild'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const id = pkg.name
const outfile = (pkg.exports?.['./client'] ?? './lib/client.js').replace(/^\.\//, '')

const EXTERNALS = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store', '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-ui-sidebar-right',
  '@deepseek-ai/dsh-client-modules', '@deepseek-ai/dsh-client-locale',
  '@deepseek-ai/dsh-client-ui-conversation',
]

try {
  await build({
    entryPoints: ['src/client/index.js'],
    bundle: true,
    platform: 'browser',
    format: 'cjs',
    external: EXTERNALS,
    outfile,
    // esbuild has no intro option; the official preset defines module/exports
    // before the bundled code (the tail assigns module.exports), so we fold the
    // same two lines into the banner.
    banner: { js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {\nvar module = { exports: {} }; var exports = module.exports;` },
    footer: { js: 'return module.exports; } });' },
    logLevel: 'info',
  })
  console.log(`client bundle written: ${outfile}`)
} catch (error) {
  console.error(`build-client: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
