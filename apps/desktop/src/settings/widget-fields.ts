import type { WidgetSetting } from '@scuttler/tui'

/**
 * Which of a widget's settings fields Settings shows without "show more".
 *
 * A widget that can find its own credentials (it declares `requires`: a CLI
 * login) hides an empty optional field while healthy: the CLI did the job.
 * Every other widget shows all its fields, because "ok" says nothing about
 * whether a key is in (the arr widget is ok with none set, Mitch, 2026-11-24).
 */
export function shownFields(
  settings: WidgetSetting[],
  o: {
    selfServe: boolean
    attention: boolean
    isSet: (s: WidgetSetting) => boolean
  },
): string[] {
  return settings
    .filter((s) => !o.selfServe || o.attention || o.isSet(s) || s.required)
    .map((s) => s.key)
}
