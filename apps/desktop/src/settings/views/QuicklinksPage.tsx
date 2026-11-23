import type { Link } from '@scuttler/core/types'
import { Plus, X } from 'lucide-react'

import { pageDef } from '../pages'
import type { PageProps } from '../types'
import { Block, Page, Row, Section, Toggle } from '../ui'
import { PAGE_ICONS } from './icons'

/** Settings → Quicklinks: the links table, then what Enter does when nothing matches. */
export function QuicklinksPage({ config, set }: PageProps) {
  const def = pageDef('quicklinks')
  const setLink = (i: number, patch: Partial<Link>) => {
    const links = config.links.slice()
    links[i] = { ...links[i]!, ...patch }
    set('links', links)
  }
  return (
    <Page
      icon={PAGE_ICONS.quicklinks}
      title={def.label}
      description={
        <>
          Links open on Enter; add <code>{'{query}'}</code> to a URL to make it
          a quicklink with a trigger word.
        </>
      }
      configKey={def.configKey}
    >
      <Section
        title="Links"
        aside={config.links.length ? `${config.links.length}` : undefined}
      >
        <Block anchor="Links">
          {config.links.length > 0 && (
            <div className="linkgrid linkgrid-head">
              <span>name</span>
              <span>url</span>
              <span>trigger</span>
              <span />
            </div>
          )}
          {config.links.map((link, i) => (
            <div className="linkgrid" key={i}>
              <input
                aria-label="name"
                placeholder="name"
                value={link.name}
                onChange={(e) => setLink(i, { name: e.target.value })}
              />
              <input
                aria-label="url"
                placeholder="https://…"
                value={link.url}
                onChange={(e) => setLink(i, { url: e.target.value })}
              />
              <input
                aria-label="trigger"
                placeholder="trigger"
                value={link.trigger ?? ''}
                onChange={(e) =>
                  setLink(i, { trigger: e.target.value || null })
                }
              />
              <button
                type="button"
                className="btn icon dim"
                title="remove"
                onClick={() =>
                  set(
                    'links',
                    config.links.filter((_, j) => j !== i),
                  )
                }
              >
                <X size={12} strokeWidth={1.8} aria-hidden />
              </button>
            </div>
          ))}
          {config.links.length === 0 && (
            <p className="blk-hint">No links yet.</p>
          )}
          <div className="btnrow">
            <button
              type="button"
              className="btn"
              onClick={() =>
                set('links', [...config.links, { name: '', url: '' }])
              }
            >
              <Plus size={12} strokeWidth={1.8} aria-hidden />
              add link
            </button>
          </div>
        </Block>
      </Section>

      <Section title="Search">
        <Row
          label="Fallback search"
          cfg="searchFallback"
          hint={
            <>
              Opens when nothing matches; <code>{'{query}'}</code> is replaced
              with your input.
            </>
          }
          below={
            <input
              className="wide"
              aria-label="Fallback search URL"
              value={config.searchFallback}
              onChange={(e) => set('searchFallback', e.target.value)}
            />
          }
        />
        <Row
          label="Index browser bookmarks"
          cfg="indexBookmarks"
          hint="Chrome-family and Safari; local reads only."
        >
          <Toggle
            label="Index browser bookmarks"
            checked={config.indexBookmarks}
            onChange={(on) => set('indexBookmarks', on)}
          />
        </Row>
      </Section>
    </Page>
  )
}
