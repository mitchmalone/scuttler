'use client'

import type { BarHoverApi } from '@scuttlarr/tui'
import { BAR_HOVER_CLOSE_MS } from '@scuttlarr/tui/bar'
import { useEffect, useRef, useState } from 'react'

/**
 * The website's implementation of the kit's `BarHoverApi`.
 *
 * The desktop app's `useBarHover` gets cursor positions polled from Rust —
 * WebKit won't deliver hover to a never-active accessory window — and resizes
 * its window around the open card. A browser has real pointer events and no
 * window to grow, so only the *semantics* are shared: the card stays open while
 * the cursor is on the cell or the card, and closes after a grace period.
 */

export function useWebBarHover(initial: string | null = null): BarHoverApi {
  const [hovered, setHovered] = useState<string | null>(initial)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => clearTimeout(timer.current), [])

  const stay = () => clearTimeout(timer.current)
  return {
    hovered,
    stay,
    enter: (id) => {
      stay()
      setHovered(id)
    },
    leave: () => {
      stay()
      timer.current = setTimeout(() => setHovered(initial), BAR_HOVER_CLOSE_MS)
    },
    // No window to resize on a web page.
    cardRef: () => {},
  }
}
