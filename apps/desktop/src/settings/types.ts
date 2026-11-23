import type { Config } from '../lib/config'

/** Set one top-level config key; the shell autosaves. */
export type SetFn = <K extends keyof Config>(key: K, value: Config[K]) => void
/** Several keys in one state update (`set` twice would clobber). */
export type PatchFn = (p: Partial<Config>) => void

/** What every page view receives. */
export type PageProps = { config: Config; set: SetFn; patch: PatchFn }
