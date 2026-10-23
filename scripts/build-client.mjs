// Client bundle build (S4 R1): esbuild -> the DSH client closure-factory
// shape (window.__ModuleLoader__.load({id, factory})). Externals stay
// external and resolve through the loader module table at runtime.
import { build } from 'esbuild'

const EXTERNALS = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store', '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-ui-sidebar-right',
  '@deepseek-ai/dsh-client-modules', '@deepseek-ai/dsh-client-locale',
  '@deepseek-ai/dsh-client-ui-conversation',
]

await build({
  entryPoints: ['src/client/index.tsx'],
  bundle: true,
  platform: 'browser',
  format: 'cjs',
  external: EXTERNALS,
  outfile: 'lib/client.js',
  banner: { js: 'window.__ModuleLoader__.load({ id: "dsh-learn-everything", factory: (require) => {' },
  footer: { js: 'return module.exports; } });' },
  logLevel: 'info',
})
console.log("client bundle written: lib/client.js")
