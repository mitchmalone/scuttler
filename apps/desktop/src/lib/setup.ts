import { invoke } from '@tauri-apps/api/core'

/** Mirrors `SetupVerb` in src-tauri/src/setup.rs (kebab-case on the wire). */
export type SetupVerb =
  | 'doctor'
  | 'defaults-plan'
  | 'defaults-apply'
  | 'link'
  | 'unlink'
  | 'migrate'
  | 'shell-plan'
  | 'shell-apply'
  | 'version'
  | 'sudoers-on'
  | 'sudoers-off'
  | 'sudoers-status'

export type SetupOutput = {
  ok: boolean
  output: string
  base: string
}

/** Run one verb of the bundled setup CLI. Never interactive in the panel;
 * `sudoers-on|off` put up the system admin dialog (one password) and come
 * back with `ok` false when it was cancelled. */
export function runSetup(verb: SetupVerb): Promise<SetupOutput> {
  return invoke<SetupOutput>('setup_run', { verb })
}
