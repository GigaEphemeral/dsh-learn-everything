// Client half (S4): registers an "Obsidian" tab into DSH native right
// sidebar via ctx.sidebarRightTabs + body/title slots (plain JS).

import { createElement } from 'react'
import { ObsidianPanel } from './ObsidianPanel.js'

export const name = 'dsh-learn-everything'
export const inject = ['slots', 'sidebarRightTabs']

export function apply(ctx) {
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
      return () => { disposeType(); offBody(); offTitle() }
    })
  })
}

function ObsidianTitle(props) {
  return createElement('span', null, 'Obsidian')
}
