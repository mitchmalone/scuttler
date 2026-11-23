import type { UsageReport } from '@scuttler/tui'
import { invoke } from '@tauri-apps/api/core'
import { useEffect, useState } from 'react'

import type {
  AgentsConfig,
  ClaudeAccountConfig,
  Config,
} from '../../lib/config'
import { HooksRow } from '../HooksRow'
import { pageDef } from '../pages'
import type { PageProps } from '../types'
import { Page, Row, Section, Toggle } from '../ui'
import { PAGE_ICONS } from './icons'

/**
 * Settings → Agents: the three agent features, each a section with its own
 * switch — ask from the prompt, local session monitoring, token usage.
 */
export function AgentsPage({ config, set }: PageProps) {
  const def = pageDef('agents')
  const agents = config.agents
  const setAgents = (patch: Partial<Config['agents']>) =>
    set('agents', { ...agents, ...patch })
  return (
    <Page
      icon={PAGE_ICONS.agents}
      title={def.label}
      description={def.description}
      configKey={def.configKey}
    >
      <Section title="Ask">
        <Row
          label="Enable agent mode"
          cfg="askMode"
          hint={
            <>
              Press <code>?</code> in the launcher to converse with your own
              agent CLI: your subscription, your credentials. The CLI is caged
              (empty working dir, tightest tool restrictions it offers); Enter
              sends, follow-ups keep context, Esc ends the conversation.
            </>
          }
        >
          <Toggle
            label="Enable agent mode"
            checked={agents.askMode}
            onChange={(on) => setAgents({ askMode: on })}
          />
        </Row>
        {agents.askMode && (
          <Row label="Provider" cfg="askProvider">
            <select
              aria-label="Provider"
              value={agents.askProvider}
              onChange={(e) =>
                setAgents({
                  askProvider: e.target
                    .value as Config['agents']['askProvider'],
                })
              }
            >
              <option value="claude">claude (Claude Code)</option>
              <option value="codex">codex (Codex CLI)</option>
            </select>
          </Row>
        )}
      </Section>

      <Section title="Sessions">
        <Row
          label="Enable local agent monitoring"
          cfg="monitor"
          hint={
            <>
              Live session states in the bar and the <code>agents ⏎</code>{' '}
              panel. Agents report in over a local socket (
              <code>agents.sock</code>); nothing leaves this machine.
            </>
          }
        >
          <Toggle
            label="Enable local agent monitoring"
            checked={agents.monitor}
            onChange={(on) => setAgents({ monitor: on })}
          />
        </Row>
        {agents.monitor && (
          <>
            <HooksRow />
            <Row label="Show idle sessions in the bar" cfg="showIdle">
              <Toggle
                label="Show idle sessions in the bar"
                checked={agents.showIdle}
                onChange={(on) => setAgents({ showIdle: on })}
              />
            </Row>
            <Row
              label="Forget sessions after"
              cfg="pruneHours"
              hint="Hours of silence before a session leaves the bar."
            >
              <input
                className="tiny center"
                aria-label="Forget sessions after, in hours"
                type="number"
                min={1}
                max={168}
                value={agents.pruneHours}
                onChange={(e) =>
                  setAgents({
                    pruneHours: Math.max(1, Number(e.target.value) || 12),
                  })
                }
              />
              <span className="dimtext">hours</span>
            </Row>
          </>
        )}
      </Section>

      <Section title="Usage">
        <Row
          label="Enable agent usage"
          cfg="usage"
          hint={
            <>
              The <code>usage ⏎</code> token monitor: tokens by day and model,
              read from the journals Claude Code and Codex already keep locally.
            </>
          }
        >
          <Toggle
            label="Enable agent usage"
            checked={agents.usage}
            onChange={(on) => setAgents({ usage: on })}
          />
        </Row>
        {agents.usage && (
          <>
            <Row
              label="Claude credentials"
              cfg="claudeCreds"
              hint="Account limits (how soon am I rate-limited?) are computed by the provider, so showing them is one HTTPS request using the credentials Claude Code already stores. File first (silent); keychain when the file is stale, and macOS shows its own prompt once per account. Never refreshed or written."
              below={
                <ClaudeAccountsList agents={agents} setAgents={setAgents} />
              }
            >
              <Toggle
                label="Claude credentials"
                checked={agents.claudeCreds}
                onChange={(on) => setAgents({ claudeCreds: on })}
              />
            </Row>
            <Row
              label="Codex credentials"
              cfg="codexCreds"
              hint={
                <>
                  May read <code>~/.codex/auth.json</code>. Off, the panel shows
                  this device&apos;s last session snapshot only, which misses
                  usage from your other machines.
                </>
              }
            >
              <Toggle
                label="Codex credentials"
                checked={agents.codexCreds}
                onChange={(on) => setAgents({ codexCreds: on })}
              />
            </Row>
          </>
        )}
      </Section>
    </Page>
  )
}

/**
 * The Claude accounts usage.rs discovered — `~/.claude` plus every
 * `~/.claude-*` (one login per `CLAUDE_CONFIG_DIR`). Nothing to add here:
 * the list *is* the directory convention; a row only renames or hides.
 */
function ClaudeAccountsList({
  agents,
  setAgents,
}: {
  agents: AgentsConfig
  setAgents: (patch: Partial<AgentsConfig>) => void
}) {
  const [report, setReport] = useState<UsageReport | null>(null)
  useEffect(() => {
    let live = true
    const poll = () =>
      invoke<UsageReport>('usage_status')
        .then((r) => live && setReport(r))
        .catch(console.error)
    poll()
    // The first call kicks the scan; one retry picks up the result.
    const id = setTimeout(poll, 2500)
    return () => {
      live = false
      clearTimeout(id)
    }
  }, [])
  const accounts = (report?.providers ?? []).filter(
    (p) => p.provider === 'claude',
  )
  const dirFor = (id: string) => `~/.${id}`
  const overrideFor = (id: string) =>
    agents.claudeAccounts.find((a) => a.dir === dirFor(id))
  const setOverride = (id: string, patch: Partial<ClaudeAccountConfig>) => {
    const dir = dirFor(id)
    const rest = agents.claudeAccounts.filter((a) => a.dir !== dir)
    const merged: ClaudeAccountConfig = {
      dir,
      label: null,
      enabled: true,
      ...overrideFor(id),
      ...patch,
    }
    // Back to defaults → drop the entry rather than store a no-op.
    const noop = merged.enabled && !merged.label
    setAgents({ claudeAccounts: noop ? rest : [...rest, merged] })
  }
  // Hidden accounts are absent from the report; keep their rows from config.
  const hidden = agents.claudeAccounts.filter(
    (a) => !a.enabled && !accounts.some((p) => dirFor(p.id) === a.dir),
  )
  if (accounts.length === 0 && hidden.length === 0) return null
  return (
    <div className="accounts">
      <p className="blk-hint">
        One account per Claude Code config dir (<code>~/.claude</code>,{' '}
        <code>~/.claude-*</code>): rename or hide.
      </p>
      {accounts.map((p) => {
        const o = overrideFor(p.id)
        return (
          <div key={p.id} className="account-row">
            <Toggle
              label={`Show ${dirFor(p.id)}`}
              checked={o?.enabled ?? true}
              onChange={(on) => setOverride(p.id, { enabled: on })}
            />
            <code>{dirFor(p.id)}</code>
            <input
              type="text"
              className="account-label"
              placeholder={p.label}
              value={o?.label ?? ''}
              onChange={(e) =>
                setOverride(p.id, { label: e.target.value || null })
              }
            />
            {p.account && <span className="dimtext">{p.account}</span>}
          </div>
        )
      })}
      {hidden.map((a) => (
        <div key={a.dir} className="account-row">
          <Toggle
            label={`Show ${a.dir}`}
            checked={false}
            onChange={() =>
              setAgents({
                claudeAccounts: agents.claudeAccounts.filter(
                  (x) => x.dir !== a.dir,
                ),
              })
            }
          />
          <code>{a.dir}</code>
          <span className="dimtext">hidden</span>
        </div>
      ))}
    </div>
  )
}
