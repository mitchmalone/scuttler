'use client'

import { useState } from 'react'

import { DemoBar } from '@/components/demo/bar'

import { BarThemeScope } from './bar-theme-scope'

/**
 * A still of the bar for the explainer section: the same `DemoBar` the live demo
 * renders, frozen at one instant so it reads like a screenshot, in the picked
 * app theme. The website owns no bar markup (AGENTS invariant 10).
 */
export function BarStrip() {
  // Fixed instant, chosen once: this is a still, not a live strip.
  const [at] = useState(() => new Date(2026, 7, 16, 9, 41))
  return (
    <BarThemeScope className="overflow-hidden rounded-[10px] border border-(--hair)">
      <DemoBar at={at} />
    </BarThemeScope>
  )
}
