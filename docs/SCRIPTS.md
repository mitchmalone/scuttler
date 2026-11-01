# scuttler scripts

Scripts are first-class citizens: drop a **TypeScript file** (or any executable) into
`~/.config/scuttler/scripts/` and its trigger word joins the launcher grammar — no
build, no chmod, no restart, no store, no manifest file. `.ts` runs under Bun (or Node —
DECISIONS 2026-08-19). The bundled scripts (`json-format.ts`, `ip.ts`) are reference
implementations and yours to edit; `lorem` is a built-in.

## The contract

Any `.ts`/`.js` file (Bun/Node) or executable (any language) that answers two invocations:

### `<script> manifest`

Print a JSON manifest to stdout and exit 0:

```json
{
  "trigger": "ip",
  "name": "Local IP",
  "description": "Your addresses, copy on Enter"
}
```

- `trigger` — the word that activates the script (`ip`, `json {…}`). No whitespace. First
  registration wins on collision; a built-in trigger (`lorem`, `clip`) cannot be claimed.
- `description` — optional, shown nowhere yet (reserved for a future script browser).

### `<script> query <args>`

`<args>` is everything the user typed after the trigger word, verbatim, as one argument.
Called on every keystroke (debounced ~120ms). Print results to stdout and exit 0:

```json
{
  "items": [
    {
      "title": "Copy 3 paragraphs of lorem ipsum",
      "subtitle": "1,338 chars",
      "action": { "type": "copy", "value": "Lorem ipsum dolor…" }
    }
  ]
}
```

- The panel shows eight rows at most, so items past the eighth are never seen. `subtitle`
  is optional (renders in the dimmed hint column).
- `altAction` (optional, same shape as `action`) runs on ⌥⏎ instead.
- `action` decides what Enter does:
  - `{"type": "copy", "value": "…"}` — put text on the clipboard
  - `{"type": "open", "value": "…"}` — `open` a URL, file, or app
  - `{"type": "none"}` (default) — informational row, Enter dismisses only

## Rules of the road

- **Timeouts:** manifest 1.5s, query 3s. A slow script gets killed, not waited for.
- **stderr is ignored**, exit non-zero = no results. Debug by running the script by hand.
- **Network is your business** for scripts: fetch what you like, mind the timeouts.
- **TypeScript:** guard the entry point with `if (import.meta.main)` (see the bundled
  scripts) so the file also imports cleanly into a test; type-only imports from
  `@scuttler/core/types` are erased at run time. No Bun or Node on the machine → the
  script is skipped with a log line (`needs bun — brew install oven-sh/bun/bun`).
- **Other languages:** any executable works. Python's one trap: the scripts dir is
  `sys.path[0]`, so a script named after a stdlib module shadows it (the pre-v0.6 bundled
  `.py` scripts are parked as `*.py.retired` on first launch).

## The bar has the same idea

A cell in the bar is a **widget** (`docs/WIDGETS.md`: one file answering `manifest` /
`tick`) or a **plugin** (`docs/PLUGINS.md`: a directory with its own React cell and panel).

## Built-in triggers

`lorem` and `clip` (clipboard history) are built-ins, not scripts — their triggers
participate in the same grammar and cannot be claimed by a script.
