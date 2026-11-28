import { listen } from '@tauri-apps/api/event'
import { useCallback, useEffect, useState } from 'react'

import {
  type AppearanceInputs,
  appearanceInputs,
} from '../../lib/use-appearance-policy'

/** Rust's appearance inputs, live: fetched on mount, then every
 * `appearance-input` (macOS light/dark, the Focus database). `refresh` asks again
 * now — after granting Full Disk Access, say. */
export function useAppearanceInputs(): {
  inputs: AppearanceInputs | null
  refresh: () => void
} {
  const [inputs, setInputs] = useState<AppearanceInputs | null>(null)
  const refresh = useCallback(() => {
    appearanceInputs().then(setInputs).catch(console.error)
  }, [])
  useEffect(() => {
    refresh()
    const un = listen<AppearanceInputs>('appearance-input', (e) =>
      setInputs(e.payload),
    )
    return () => {
      un.then((f) => f())
    }
  }, [refresh])
  return { inputs, refresh }
}
