import { useCallback, useEffect, useState } from 'react'

import { type SetupOutput, type SetupVerb, runSetup } from '../../lib/setup'
import { pageDef, rungState } from '../pages'
import type { PageProps } from '../types'
import { Block, Note, Page, Row, RungOff, Section, Toggle } from '../ui'
import { PAGE_ICONS } from './icons'

/**
 * Settings → Machine: the rung above theme (DECISIONS 2026-09-11). Everything
 * here is the bundled setup CLI (`packages/setup`) run with a fixed verb —
 * the page is a front for `scuttler doctor | defaults | shell | link |
 * migrate | sudoers`, not a second implementation. `remove` stays
 * terminal-only on purpose.
 */
export function MachinePage({ config, set }: PageProps) {
  const def = pageDef('machine')
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

  // Opening the page shows the doctor's view first — read-only, cheap.
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
  const rung = rungState('machine', config)
  const idle = busy !== null

  return (
    <Page
      icon={PAGE_ICONS.machine}
      title={def.label}
      description={
        <>
          {def.description} Everything here is the <code>scuttler</code> CLI,
          shipped inside the app.
        </>
      }
      configKey={def.configKey}
      aside={<span className={`pill ${rung}`}>rung {rung}</span>}
    >
      {machine.enabled ? (
        <Section title="Rung">
          <Row
            label="Machine rung"
            cfg="enabled"
            hint={
              <>
                Puts <code>scuttler</code> on your PATH (
                <code>~/.local/bin</code>, recorded in the manifest) and runs
                pending migrations at every launch.
              </>
            }
          >
            <Toggle label="Machine rung" checked onChange={enable} />
          </Row>
        </Section>
      ) : (
        <Section title="Turning it on" plain>
          <RungOff
            anchor="Machine rung"
            lines={[
              {
                mark: '+',
                text: (
                  <>
                    puts <code>scuttler</code> on your PATH (
                    <code>~/.local/bin</code>, recorded in the manifest)
                  </>
                ),
              },
              { mark: '+', text: 'runs pending migrations at every launch' },
              {
                mark: '·',
                text: 'nothing else changes until you plan and apply defaults or the shell base below',
              },
              {
                mark: '·',
                text: (
                  <>
                    undo is <code>scuttler remove</code> in a terminal, on
                    purpose
                  </>
                ),
              },
            ]}
            action="Turn on the machine rung"
            disabled={idle}
            onTurnOn={() => enable(true)}
          />
        </Section>
      )}

      <Section title="Setup">
        <Row
          label="macOS defaults"
          hint="The shine scraped off. Plan first: apply only ever follows a plan you have seen, and a snapshot is taken before it."
        >
          <button
            type="button"
            className="btn"
            disabled={idle}
            onClick={() => run('defaults-plan')}
          >
            {busy === 'defaults-plan' ? 'planning…' : 'plan'}
          </button>
          <button
            type="button"
            className="btn"
            disabled={idle || !planned}
            title={
              planned
                ? 'Apply the plan below (a snapshot is taken first)'
                : 'Plan first — apply only ever follows a plan you have seen'
            }
            onClick={() => run('defaults-apply')}
          >
            {busy === 'defaults-apply' ? 'applying…' : 'apply'}
          </button>
        </Row>
        <Row
          label="Shell base"
          hint="What makes the Theme rung reach Ghostty, tmux, your prompt and delta: its files import the current theme. Yours are moved aside, never overwritten."
        >
          <button
            type="button"
            className="btn"
            disabled={idle}
            onClick={() => run('shell-plan')}
          >
            {busy === 'shell-plan' ? 'planning…' : 'plan'}
          </button>
          <button
            type="button"
            className="btn"
            disabled={idle || !shellPlanned}
            title={
              shellPlanned
                ? 'Write ~/.zshrc, ~/.p10k.zsh, Ghostty, tmux and the git include; yours are moved aside, never overwritten'
                : 'Plan first'
            }
            onClick={() => run('shell-apply')}
          >
            {busy === 'shell-apply' ? 'applying…' : 'apply'}
          </button>
        </Row>
        <Row
          label="scuttler CLI"
          hint={
            <>
              The link at <code>~/.local/bin/scuttler</code>.
            </>
          }
        >
          <button
            type="button"
            className="btn"
            disabled={idle}
            onClick={() => run(machine.enabled ? 'link' : 'unlink')}
          >
            {machine.enabled ? 'relink' : 'unlink'}
          </button>
        </Row>
      </Section>

      <Section title="Admin">
        <Row
          label="Admin rule"
          hint={
            <>
              One rule in <code>/etc/sudoers.d/scuttler</code> lets awake switch
              macOS sleep off while a hold runs, and lets the updates panel
              upgrade App Store apps through scuttler&apos;s own root-owned copy
              of mas, each after Touch ID. Writing it is the one time scuttler
              needs your Mac password, typed into the system&apos;s own dialog.
            </>
          }
        >
          <button
            type="button"
            className="btn"
            disabled={idle || admin === true}
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
            type="button"
            className="btn dim"
            disabled={idle || admin !== true}
            title="Remove the rule (the same dialog); awake holds on power assertions alone, the App Store row says it needs admin"
            onClick={() => run('sudoers-off')}
          >
            {busy === 'sudoers-off' ? 'waiting for the dialog…' : 'remove'}
          </button>
        </Row>
      </Section>

      <Section
        title="Doctor"
        aside={
          <button
            type="button"
            className="btn"
            disabled={idle}
            onClick={() => run('doctor')}
          >
            {busy === 'doctor' ? 'checking…' : 'run doctor'}
          </button>
        }
      >
        <Block anchor="Doctor">
          {last ? (
            <>
              <p className="term-head">
                <code>$ scuttler {last.verb.replace('-', ' ')}</code>
                {last.out.ok ? '' : ' · exited with an error'} · from{' '}
                <code>{last.out.base}</code>
              </p>
              <pre className="term">{last.out.output || '(no output)'}</pre>
            </>
          ) : (
            <p className="blk-hint">{busy ? 'running…' : 'No output yet.'}</p>
          )}
          {error && <Note tone="error">{error}</Note>}
        </Block>
      </Section>

      <Note>
        Undo everything: <code>scuttler remove</code> in a terminal walks the
        manifest in reverse and restores the defaults snapshot. It is not a
        button here, on purpose.
      </Note>
    </Page>
  )
}
