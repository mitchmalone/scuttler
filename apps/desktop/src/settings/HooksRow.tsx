import { useCallback, useEffect, useState } from 'react'

import {
  HOOK_STATE_LABEL,
  type HooksStatus,
  hooksInstall,
  hooksSettled,
  hooksStatus,
} from '../lib/hooks'
import { Note, Row } from './ui'

/**
 * Settings → Agents → Sessions: the Claude Code hook adapter, per
 * account. Polled while visible so an edit to settings.json (or a fresh
 * `~/.claude-<name>`) shows up without a relaunch.
 */
export function HooksRow() {
  const [status, setStatus] = useState<HooksStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const refresh = useCallback(() => {
    hooksStatus().then(setStatus).catch(console.error)
  }, [])
  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 3000)
    return () => clearInterval(t)
  }, [refresh])

  const install = () => {
    setBusy(true)
    setError(null)
    hooksInstall()
      .then(setStatus)
      .catch((e) => setError(String(e?.detail ?? e)))
      .finally(() => setBusy(false))
  }

  if (status === null) return null
  const settled = hooksSettled(status)
  return (
    <Row
      label="Claude Code hooks"
      hint={
        <>
          Claude Code reports through a hook script scuttler installs at{' '}
          <code>{status.scriptPath}</code>
          {status.scriptCurrent ? '' : ' (not installed yet)'} and registers in
          each account&apos;s <code>settings.json</code>. Stale paths are mended
          at every launch; new accounts need the button.
        </>
      }
      below={
        <>
          {status.accounts.length === 0 ? (
            <Note>
              No Claude Code config dir found (<code>~/.claude</code>,{' '}
              <code>~/.claude-*</code>).
            </Note>
          ) : (
            <ul className="plainlist">
              {status.accounts.map((a) => (
                <li key={a.dir}>
                  <code>{a.dir}</code>
                  <span className={`hookstate hookstate-${a.state}`}>
                    {HOOK_STATE_LABEL[a.state]}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {error && <Note tone="error">{error}</Note>}
        </>
      }
    >
      {!settled && (
        <button type="button" className="btn" disabled={busy} onClick={install}>
          {busy ? 'installing…' : 'install hooks'}
        </button>
      )}
    </Row>
  )
}
