# Template for Casks/scuttler.rb in mitchmalone/homebrew-tap. The release workflow
# fills in the version and zip sha256 and writes the whole file on every v* tag —
# edit here, never in the tap (docs/RELEASING.md).
cask "scuttler" do
  version "@VERSION@"
  sha256 "@SHA256@"

  url "https://github.com/mitchmalone/scuttler/releases/download/v#{version}/scuttler-#{version}.zip"
  name "scuttler"
  desc "Opinionated desktop for developers who live in the terminal"
  homepage "https://www.scuttler.app/"

  # The app updates itself (selfupdate.rs); brew must not fight it.
  auto_updates true
  depends_on arch: :arm64
  # The Desktop rung wraps AeroSpace. JankyBorders is deliberately NOT a dependency
  # (GPL-3, opt-in from Settings -> Desktop).
  depends_on cask: "nikitabobko/tap/aerospace"
  depends_on macos: :sonoma

  app "scuttler.app"

  zap trash: [
    "~/.config/scuttler",
    "~/.local/state/scuttler",
    "~/Library/Application Support/com.mitchmalone.scuttlarr",
    "~/Library/LaunchAgents/scuttler.plist",
  ]
end
