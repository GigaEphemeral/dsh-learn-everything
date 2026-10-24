// Client half (S4): registers an "Obsidian" tab into DSH native right
// sidebar via ctx.sidebarRightTabs + body/title slots (plain JS), and the
// bundle's configuration card into the DSH Plugins page.

import { createElement } from 'react'
import { ObsidianPanel } from './ObsidianPanel.js'
import { ObsidianConfigCard } from './ObsidianConfigCard.js'
import { createObsidianConfigForm } from './obsidian-config-form.js'
import { registerBundleConfigPage, LOCALE_NS } from './config-page.js'
import { zh, en } from './config-locales.js'

export const name = 'dsh-learn-everything'
export const inject = ['slots', 'sidebarRightTabs', 'configForms', 'locale']

export function apply(ctx) {
  ctx.effect(() => ctx.locale.register(LOCALE_NS, { zh, en }), 'dsh-learn-everything: config dictionaries')
  // The Plugins page only shows a configuration form for a bundle that
  // registered a `plugins.bundle.config` entry keyed by its package name;
  // the form reads the plugin's settings namespace through configForms.
  ctx.effect(() => {
    const form = createObsidianConfigForm(ctx)
    const off = registerBundleConfigPage(ctx, {
      component: ObsidianConfigCard,
      locale: LOCALE_NS,
      inject: () => ({ ...form }),
    })
    return () => {
      if (typeof off === 'function') off()
      form.dispose()
    }
  }, 'dsh-learn-everything: Plugins-page config card')

  ctx.inject(['sidebarRightTabs'], (injected) => {
    const tabs = injected.get('sidebarRightTabs')
    if (!tabs || typeof tabs.register !== 'function') return
    ctx.effect(() => {
      const disposeType = tabs.register({
        id: 'obsidian',
        kind: 'dsh-learn-everything:obsidian',
        keepMounted: true,
        priority: 'extension',
        title: () => 'Obsidian',
        guide: [{
          id: 'dsh-learn-everything:obsidian',
          order: 150,
          title: () => 'Obsidian',
          description: () => 'Obsidian 知识库访问面板（S4）',
        }],
      })
      // The host keys a tab body by the slot entry key (matching the type id)
      // and renders the COMPONENT passed as register() second argument.
      const offBody = ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
        name: 'sidebar.right.pane.tab',
        key: 'obsidian',
        inject: (sessionId) => ({ sessionId }),
      }, ObsidianPanel))
      const offTitle = ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
        name: 'sidebar.right.pane.tab.title',
        key: 'obsidian',
        inject: (sessionId) => ({ sessionId }),
      }, ObsidianTitle))
      return () => {
        disposeType()
        if (typeof offBody === 'function') offBody()
        if (typeof offTitle === 'function') offTitle()
      }
    })
  })
}

function ObsidianTitle(props) {
  return createElement('span', null, 'Obsidian')
}
