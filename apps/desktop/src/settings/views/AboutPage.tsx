import { GithubIcon, XIcon } from '@scuttler/tui/icons'
import { getVersion } from '@tauri-apps/api/app'
import { invoke } from '@tauri-apps/api/core'
import { BookOpen, Globe, Tag } from 'lucide-react'
import { useEffect, useState } from 'react'

import iconUrl from '../scuttler.svg'
import { Page, Row, Section } from '../ui'
import { PAGE_ICONS } from './icons'

/** Where scuttler lives on the web. */
const SITE_URL = 'https://www.scuttler.app'
const DOCS_URL = 'https://www.scuttler.app/docs'
const GITHUB_URL = 'https://github.com/mitchmalone/scuttler'
const RELEASES_URL = `${GITHUB_URL}/releases`
const X_URL = 'https://x.com/mitchmalone'

/** Settings → About: who, which version, where — and the file this window edits. */
export function AboutPage() {
  const [version, setVersion] = useState('')
  useEffect(() => {
    getVersion().then(setVersion).catch(console.error)
  }, [])
  const open = (url: string) => invoke('open_url', { url }).catch(console.error)
  const links: { label: string; url: string; icon: React.ReactNode }[] = [
    {
      label: 'www.scuttler.app',
      url: SITE_URL,
      icon: <Globe size={13} strokeWidth={1.75} aria-hidden />,
    },
    {
      label: 'docs',
      url: DOCS_URL,
      icon: <BookOpen size={13} strokeWidth={1.75} aria-hidden />,
    },
    { label: 'github', url: GITHUB_URL, icon: <GithubIcon size={13} /> },
    {
      label: 'releases',
      url: RELEASES_URL,
      icon: <Tag size={13} strokeWidth={1.75} aria-hidden />,
    },
    { label: '@mitchmalone', url: X_URL, icon: <XIcon size={13} /> },
  ]
  return (
    <Page icon={PAGE_ICONS.about} title="About">
      <div className="about">
        <img className="appicon" src={iconUrl} alt="scuttler icon" />
        <div>
          <p className="wordmark">
            <span className="sigil">❯</span> scuttler
            {version ? <span className="dimtext"> v{version}</span> : null}
          </p>
          <p className="dimtext">The keyboard control surface for macOS.</p>
          <p className="dimtext">
            Scuttle the ship. Sail the wreck. By{' '}
            <button
              type="button"
              className="linkish"
              onClick={() => open(X_URL)}
            >
              Mitch Malone
            </button>
            .
          </p>
          <div className="btnrow">
            {links.map((l) => (
              <button
                key={l.url}
                type="button"
                className="btn"
                onClick={() => open(l.url)}
              >
                {l.icon}
                {l.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <Section title="Files">
        <Row
          label="Config file"
          hint={
            <>
              This whole window is a view over{' '}
              <code>~/.config/scuttler/config.json</code>: edit either place,
              changes apply live. Scripts extend the prompt (see docs).
            </>
          }
        >
          <button
            type="button"
            className="btn"
            onClick={() => invoke('open_path', { target: 'config' })}
          >
            edit config.json
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => invoke('open_path', { target: 'scripts' })}
          >
            open scripts folder
          </button>
        </Row>
      </Section>

      <p className="aboutfoot">
        No permissions unless you turn something on, no telemetry. Because the
        apps won&apos;t launch themselves. Yarr.
      </p>
    </Page>
  )
}
