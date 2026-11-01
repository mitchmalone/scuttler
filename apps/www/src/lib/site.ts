import releaseJson from './release.json'

/**
 * Release facts flow FROM the app repo: `release.json` is written by
 * `scuttlarr/scripts/release.sh` and must never be hand-edited. Everything the
 * site says about versions, artifacts, and install methods derives from it.
 */
export interface ReleaseArtifact {
  url: string
  sha256: string
}

export interface Release {
  version: string
  date: string
  signed: boolean
  artifacts: { zip: ReleaseArtifact; dmg: ReleaseArtifact } | null
}

export const RELEASE = releaseJson as Release
export const VERSION = `v${RELEASE.version}`

/** The site's own origin: metadata, the sitemap and the install URL derive from it. */
export const SITE_URL = 'https://scuttlarr.com'
export const GITHUB_URL = 'https://github.com/mitchmalone/scuttlarr'
export const RELEASES_URL = `${GITHUB_URL}/releases`
/** The repo's docs, which the site links to rather than copies (AGENTS: docs link, never duplicate). */
export const DOCS_URL = `${GITHUB_URL}/blob/main/docs`
export const README_URL = `${GITHUB_URL}#readme`

/** The install the README leads with: preflight, the cask, open the app. */
export const INSTALL_COMMAND = `curl -fsSL ${SITE_URL}/install | sh`
export const BREW_COMMAND = 'brew install --cask mitchmalone/tap/scuttlarr'

export const SOURCE_INSTALL_COMMANDS = [
  'git clone git@github.com:mitchmalone/scuttlarr.git',
  'cd scuttlarr',
  'pnpm install',
  'pnpm --filter @scuttlarr/desktop tauri build',
  'cp -R apps/desktop/src-tauri/target/release/bundle/macos/scuttlarr.app /Applications/',
  'open /Applications/scuttlarr.app',
]
