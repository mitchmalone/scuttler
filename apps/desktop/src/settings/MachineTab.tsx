import { useCallback, useEffect, useState } from 'react'

import type { Config } from '../lib/config'
import { type SetupOutput, type SetupVerb, runSetup } from '../lib/setup'

/**
 * Settings → Machine: the rung above theme (DECISIONS 2026-09-11). Everything
 * here is the bundled setup CLI (`packages/setup`) run with a fixed verb —
 * the tab is a front for `scuttler doctor | defaults | link | migrate`, not
 * a second implementation. `remove` stays terminal-only on purpose.
 */

type SetFn = <K extends keyof Config>(key: K, value: Config[K]) => void

export default function MachineTab({
  config,
  set,
}: {
  config: Config
  set: SetFn
}) {
  const machine = config.machine ?? { enabled: false }
  const [busy, setBusy] = useState<SetupVerb | null>(null)
  const [last, setLast] = useState<{
    verb: SetupVerb
    out: SetupOutput
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [planned, setPlanned] = useState(false)
  const [shellPlanned, setShellPlanned] = useState(false)
  // The sudoers rule: on, off, or not yet asked. Read from the file by the
  // CLI (`sudoers status`), never probed with sudo.
  const [admin, setAdmin] = useState<boolean | null>(null)

  const run = useCallback(async (verb: SetupVerb) => {
    setBusy(verb)
    setError(null)
    try {
      const out = await runSetup(verb)
      setLast({ verb, out })
      if (verb === 'defaults-plan') setPlanned(out.ok)
      if (verb === 'defaults-apply') setPlanned(false)
      if (verb === 'shell-plan') setShellPlanned(out.ok)
      if (verb === 'shell-apply') setShellPlanned(false)
      if (verb === 'sudoers-on' || verb === 'sudoers-off') {
        setAdmin((await runSetup('sudoers-status')).ok)
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(null)
    }
  }, [])

  // Opening the tab shows the doctor's view first — read-only, cheap.
  useEffect(() => {
    void run('doctor')
    runSetup('sudoers-status').then(
      (out) => setAdmin(out.ok),
      () => setAdmin(null),
    )
  }, [run])

  const enable = (enabled: boolean) => {
    set('machine', { ...machine, enabled })
    if (enabled) void run('link').then(() => run('migrate'))
  }

  return (
    <>
      <p className="hint lead">
        The machine rung: macOS defaults with the shine scraped off, a manifest
        of every file scuttler writes outside its own config, adopt never
        overwrite, and a way back. Everything below is the <code>scuttler</code>{' '}
        CLI, shipped inside the app.
      </p>

      <label className="check">
        <input
          type="checkbox"
          checked={machine.enabled}
          onChange={(e) => enable(e.target.checked)}
        />
        Enable the machine rung
      </label>
      <p className="hint">
        Puts <code>scuttler</code> on your PATH (<code>~/.local/bin</code>,
        recorded in the manifest) and runs pending migrations at every launch.
        Nothing else changes until you apply defaults or the shell base below.
        The shell base is what makes the Theme rung reach Ghostty, tmux, your
        prompt and delta: its files import the current theme.
      </p>

      <div className="buttonrow">
        <button
          className="ghost"
          disabled={busy !== null}
          onClick={() => run('doctor')}
        >
          {busy === 'doctor' ? 'checking…' : 'doctor'}
        </button>
        <button
          className="ghost"
          disabled={busy !== null}
          onClick={() => run('defaults-plan')}
        >
          {busy === 'defaults-plan' ? 'planning…' : 'plan defaults'}
        </button>
        <button
          className="ghost"
          disabled={busy !== null || !planned}
          title={
            planned
              ? 'Apply the plan above (a snapshot is taken first)'
              : 'Plan first — apply only ever follows a plan you have seen'
          }
          onClick={() => run('defaults-apply')}
        >
          {busy === 'defaults-apply' ? 'applying…' : 'apply defaults'}
        </button>
        <button
          className="ghost"
          disabled={busy !== null}
          onClick={() => run('shell-plan')}
        >
          {busy === 'shell-plan' ? 'planning…' : 'plan shell'}
        </button>
        <button
          className="ghost"
          disabled={busy !== null || !shellPlanned}
          title={
            shellPlanned
              ? 'Write ~/.zshrc, ~/.p10k.zsh, Ghostty, tmux and the git include; yours are moved aside, never overwritten'
              : 'Plan first'
          }
          onClick={() => run('shell-apply')}
        >
          {busy === 'shell-apply' ? 'applying…' : 'apply shell'}
        </button>
        <button
          className="ghost"
          disabled={busy !== null}
          onClick={() => run(machine.enabled ? 'link' : 'unlink')}
        >
          {machine.enabled ? 'relink CLI' : 'unlink CLI'}
        </button>
      </div>

      <p className="hint">
        <strong>Admin, once.</strong> One rule in{' '}
        <code>/etc/sudoers.d/scuttler</code> lets awake switch macOS sleep off
        while a hold runs and lets the updates panel upgrade App Store apps,
        each after Touch ID. Writing it is the one time scuttler needs your Mac
        password, typed into the system&apos;s own dialog; the app never asks
        for it itself. The App Store row in <code>updates</code> offers the
        same.
      </p>
      <div className="row">
        <button
          className="ghost"
          disabled={busy !== null || admin === true}
          title={
            admin === true
              ? 'The rule is in place'
              : 'The system admin dialog: your Mac password, once'
          }
          onClick={() => run('sudoers-on')}
        >
          {busy === 'sudoers-on'
            ? 'waiting for the dialog…'
            : admin === true
              ? 'admin allowed'
              : 'allow admin'}
        </button>
        <button
          className="ghost"
          disabled={busy !== null || admin !== true}
          title="Remove the rule (the same dialog); awake holds on power assertions alone, the App Store row says it needs admin"
          onClick={() => run('sudoers-off')}
        >
          {busy === 'sudoers-off'
            ? 'waiting for the dialog…'
            : 'remove the rule'}
        </button>
      </div>

      {error && <p className="hint error">{error}</p>}
      {last && (
        <>
          <p className="hint tiny">
            <code>scuttler {last.verb.replace('-', ' ')}</code>
            {last.out.ok ? '' : ' — exited with an error'} · from{' '}
            <code>{last.out.base}</code>
          </p>
          <pre className="setup-output">{last.out.output || '(no output)'}</pre>
        </>
      )}
      <p className="hint tiny">
        Undo everything: <code>scuttler remove</code> in a terminal — it walks
        the manifest in reverse and restores the defaults snapshot. It is not a
        button here on purpose.
      </p>
    </>
  )
}
