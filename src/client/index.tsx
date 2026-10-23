// Client half (S4 R1): registers an "Obsidian" tab into DSH native right
// sidebar via ctx.sidebarRightTabs + body/title slots. Best-faith minimal
// scaffold: the exact body-slot rendering contract is verified empirically
// against the live host in the test profile.

import { createElement } from 'react'
import type { Context } from '@deepseek-ai/cordis'

export const name = 'dsh-learn-everything'
export const inject = ['slots', 'sidebarRightTabs']

export function apply(ctx: Context): void {
  ctx.inject(['sidebarRightTabs'], (injected) => {
    const tabs = injected.get('sidebarRightTabs') as unknown as { register(d: unknown): () => void } | undefined
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
      const offBody = ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
        name: 'obsidian',
        inject: (sessionId: string) => ({ sessionId, component: ObsidianPanel }),
      }))
      const offTitle = ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
        name: 'obsidian',
        inject: (sessionId: string) => ({ sessionId, title: 'Obsidian' }),
      }))
      return () => { disposeType(); offBody(); offTitle() }
    })
  })
}

// Minimal placeholder body (R1): the full panel (list/search/note/graph/
// notify) is built in R3 once the host slot contract is confirmed.
function ObsidianPanel(props: { sessionId?: string }) {
  return createElement('div', { style: { padding: 12 } },
    'Obsidian 面板（R1 占位）— session: ' + (props.sessionId ?? '?'),
  )
}
