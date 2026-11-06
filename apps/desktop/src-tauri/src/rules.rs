//! Agent state from the screen (plans/active/2026-11-06-make-agent-statuses-correct.md,
//! DECISIONS 2026-11-06).
//!
//! A cell says what you would see if you looked at the pane. The bottom of the
//! pane is matched against a rule table, one TOML file per agent under
//! `agents/`, in the shape herdr's public catalogue uses (regions, matchers,
//! priorities, skip-on-overlay) so a rule can be checked against theirs and a
//! file of theirs would drop in. The shapes in ours were recorded from herdr's
//! catalogue (herdr.dev/agent-detection, 2026-11-06) and from our own panes;
//! each file says so in its header.
//!
//! Three states on the wire: `working`, `blocked`, `idle`; `unknown` and
//! `skip_state_update` both mean "an overlay is up, say nothing". Blocked is
//! strict: only a visible approval, question or permission UI. Nothing matched
//! is `None`, and the caller keeps the state it had.

use regex::Regex;
use serde::Deserialize;
use std::sync::OnceLock;

/// What the classifier reads: the pane's title (tmux `#{pane_title}`, which
/// carries the agent's OSC title) and its last lines, top to bottom.
pub struct Screen {
    pub title: String,
    pub lines: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum State {
    Working,
    Blocked,
    Idle,
}

/// The rule that fired. `state` is `None` for an overlay rule (`unknown` or
/// `skip_state_update`): the agent's state is whatever it was.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Verdict {
    pub rule: String,
    pub state: Option<State>,
}

/// The bundled rule files. Adding an agent is adding a file and a line here.
const BUNDLED: &[(&str, &str)] = &[
    ("agy", include_str!("../agents/agy.toml")),
    ("amp", include_str!("../agents/amp.toml")),
    ("claude", include_str!("../agents/claude.toml")),
    ("cline", include_str!("../agents/cline.toml")),
    ("codex", include_str!("../agents/codex.toml")),
    ("copilot", include_str!("../agents/copilot.toml")),
    ("cursor", include_str!("../agents/cursor.toml")),
    ("devin", include_str!("../agents/devin.toml")),
    ("droid", include_str!("../agents/droid.toml")),
    ("gemini", include_str!("../agents/gemini.toml")),
    ("grok", include_str!("../agents/grok.toml")),
    ("hermes", include_str!("../agents/hermes.toml")),
    ("kilo", include_str!("../agents/kilo.toml")),
    ("kimi", include_str!("../agents/kimi.toml")),
    ("kiro", include_str!("../agents/kiro.toml")),
    ("letta", include_str!("../agents/letta.toml")),
    ("maki", include_str!("../agents/maki.toml")),
    ("muse", include_str!("../agents/muse.toml")),
    ("opencode", include_str!("../agents/opencode.toml")),
    ("pi", include_str!("../agents/pi.toml")),
    ("qodercli", include_str!("../agents/qodercli.toml")),
    ("qwen", include_str!("../agents/qwen.toml")),
];

/// The process name an agent runs as, in a tmux pane's `#{pane_current_command}`
/// or anywhere in the foreground command line. Node and Bun CLIs show as
/// `node`/`bun`, so the command line is searched too (`agent_for_argv`).
const PROCESS_NAMES: &[(&str, &str)] = &[
    ("claude", "claude"),
    ("codex", "codex"),
    ("copilot", "copilot"),
    ("cursor-agent", "cursor"),
    ("gemini", "gemini"),
    ("opencode", "opencode"),
    ("agy", "agy"),
    ("cline", "cline"),
    ("devin", "devin"),
    ("droid", "droid"),
    ("grok", "grok"),
    ("hermes", "hermes"),
    ("kilo", "kilo"),
    ("kimi", "kimi"),
    ("kiro-cli", "kiro"),
    ("kiro", "kiro"),
    ("maki", "maki"),
    ("pi", "pi"),
    ("qodercli", "qodercli"),
    ("qwen", "qwen"),
    ("letta", "letta"),
    ("muse", "muse"),
    ("amp", "amp"),
];

/// Process names that are never an agent themselves: the interpreters agents
/// ship on top of, and the shells a pane idles in.
const INTERPRETERS: &[&str] = &["node", "bun", "deno", "python", "python3", "uv", "uvx"];

/// The agent id for a pane's foreground process name, when the name is one.
pub fn agent_for_command(comm: &str) -> Option<&'static str> {
    let base = comm.rsplit('/').next().unwrap_or(comm);
    PROCESS_NAMES
        .iter()
        .find(|(name, _)| *name == base)
        .map(|(_, id)| *id)
}

/// Whether a process name is an interpreter worth looking behind (`argv`).
pub fn is_interpreter(comm: &str) -> bool {
    let base = comm.rsplit('/').next().unwrap_or(comm);
    INTERPRETERS.contains(&base)
}

/// The agent id for a full command line: the first argv word whose basename
/// is an agent (`node /…/bin/codex --model x` → codex). Only the path words
/// are looked at, never flags or prompt text.
pub fn agent_for_argv(argv: &str) -> Option<&'static str> {
    argv.split_whitespace()
        .take_while(|w| !w.starts_with('-'))
        .find_map(agent_for_command)
}

// ---- Manifests ---------------------------------------------------------------

#[derive(Debug)]
pub struct Manifest {
    pub id: String,
    pub aliases: Vec<String>,
    rules: Vec<Rule>,
}

#[derive(Debug)]
struct Rule {
    id: String,
    state: Option<State>,
    skip: bool,
    priority: i64,
    region: Region,
    cond: Cond,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum Region {
    OscTitle,
    WholeRecent,
    BottomNonEmpty(usize),
    TopNonEmpty(usize),
    AfterLastHorizontalRule,
    PromptBoxBody,
    LastNonEmptyAbovePromptBox,
    AfterLastPromptMarker,
    BeforeCurrentPromptMarker,
    WholeRecentWithoutCurrentPromptMarker,
    /// A region we do not read (OSC progress reports): the rule never fires.
    Unsupported,
}

#[derive(Debug, Default)]
struct Cond {
    contains: Vec<String>,
    regex: Vec<Regex>,
    line_regex: Vec<Regex>,
    any: Vec<Cond>,
    all: Vec<Cond>,
    not: Vec<Cond>,
}

#[derive(Deserialize)]
struct RawManifest {
    id: String,
    #[serde(default)]
    aliases: Vec<String>,
    #[serde(default)]
    rules: Vec<RawRule>,
}

#[derive(Deserialize)]
struct RawRule {
    id: String,
    state: String,
    #[serde(default)]
    priority: i64,
    region: String,
    #[serde(default)]
    skip_state_update: bool,
    #[serde(flatten)]
    cond: RawCond,
}

#[derive(Deserialize, Default)]
struct RawCond {
    #[serde(default)]
    contains: Vec<String>,
    #[serde(default)]
    regex: Vec<String>,
    #[serde(default)]
    line_regex: Vec<String>,
    #[serde(default)]
    any: Vec<RawCond>,
    #[serde(default)]
    all: Vec<RawCond>,
    #[serde(default)]
    not: Vec<RawCond>,
}

/// Parse one manifest. A pattern that does not compile drops its rule with a
/// line on stderr (fail-visible); the bundled files are tested to have none.
pub fn parse(src: &str) -> Result<Manifest, String> {
    let raw: RawManifest = toml::from_str(src).map_err(|e| e.to_string())?;
    let mut rules = Vec::with_capacity(raw.rules.len());
    for r in raw.rules {
        let cond = match build_cond(r.cond) {
            Ok(c) => c,
            Err(e) => {
                eprintln!("[scuttler agents] rule {}/{} dropped: {e}", raw.id, r.id);
                continue;
            }
        };
        let (state, skip) = match r.state.as_str() {
            "working" => (Some(State::Working), r.skip_state_update),
            "blocked" => (Some(State::Blocked), r.skip_state_update),
            "idle" => (Some(State::Idle), r.skip_state_update),
            _ => (None, true),
        };
        rules.push(Rule {
            id: r.id,
            state,
            skip,
            priority: r.priority,
            region: parse_region(&r.region),
            cond,
        });
    }
    // Highest priority first; ties keep file order.
    rules.sort_by_key(|r| std::cmp::Reverse(r.priority));
    Ok(Manifest {
        id: raw.id,
        aliases: raw.aliases,
        rules,
    })
}

fn build_cond(raw: RawCond) -> Result<Cond, String> {
    let compile = |p: &str| Regex::new(p).map_err(|e| format!("{p}: {e}"));
    Ok(Cond {
        contains: raw.contains.iter().map(|s| s.to_lowercase()).collect(),
        regex: raw
            .regex
            .iter()
            .map(|p| compile(p))
            .collect::<Result<_, _>>()?,
        line_regex: raw
            .line_regex
            .iter()
            .map(|p| compile(p))
            .collect::<Result<_, _>>()?,
        any: raw
            .any
            .into_iter()
            .map(build_cond)
            .collect::<Result<_, _>>()?,
        all: raw
            .all
            .into_iter()
            .map(build_cond)
            .collect::<Result<_, _>>()?,
        not: raw
            .not
            .into_iter()
            .map(build_cond)
            .collect::<Result<_, _>>()?,
    })
}

fn parse_region(s: &str) -> Region {
    let s = s.trim();
    let counted = |name: &str| -> Option<usize> {
        s.strip_prefix(name)?
            .strip_prefix('(')?
            .strip_suffix(')')?
            .trim()
            .parse()
            .ok()
    };
    if let Some(n) = counted("bottom_non_empty_lines") {
        return Region::BottomNonEmpty(n);
    }
    if let Some(n) = counted("top_non_empty_lines") {
        return Region::TopNonEmpty(n);
    }
    match s {
        "osc_title" => Region::OscTitle,
        "whole_recent" => Region::WholeRecent,
        "after_last_horizontal_rule" => Region::AfterLastHorizontalRule,
        "prompt_box_body" => Region::PromptBoxBody,
        "last_non_empty_above_prompt_box" => Region::LastNonEmptyAbovePromptBox,
        "after_last_prompt_marker" => Region::AfterLastPromptMarker,
        "before_current_prompt_marker" => Region::BeforeCurrentPromptMarker,
        "whole_recent_without_current_prompt_marker" => {
            Region::WholeRecentWithoutCurrentPromptMarker
        }
        _ => Region::Unsupported,
    }
}

fn manifests() -> &'static [Manifest] {
    static ALL: OnceLock<Vec<Manifest>> = OnceLock::new();
    ALL.get_or_init(|| {
        BUNDLED
            .iter()
            .filter_map(|(name, src)| match parse(src) {
                Ok(m) => Some(m),
                Err(e) => {
                    eprintln!("[scuttler agents] rules for {name} unreadable: {e}");
                    None
                }
            })
            .collect()
    })
}

/// The manifest for an agent id or alias.
pub fn for_agent(agent: &str) -> Option<&'static Manifest> {
    manifests()
        .iter()
        .find(|m| m.id == agent || m.aliases.iter().any(|a| a == agent))
}

/// Every agent id with a rule file.
#[cfg(test)]
pub fn known_agents() -> Vec<&'static str> {
    manifests().iter().map(|m| m.id.as_str()).collect()
}

/// Classify a screen for an agent: the highest-priority rule that matches.
pub fn classify(agent: &str, screen: &Screen) -> Option<Verdict> {
    for_agent(agent).and_then(|m| m.classify(screen))
}

impl Manifest {
    pub fn classify(&self, screen: &Screen) -> Option<Verdict> {
        self.rules.iter().find_map(|r| {
            let text = region_text(&r.region, screen)?;
            (!r.cond.is_empty() && r.cond.holds(&text)).then(|| Verdict {
                rule: r.id.clone(),
                state: if r.skip { None } else { r.state },
            })
        })
    }
}

/// A horizontal rule: a line that is mostly box-drawing dashes.
fn is_rule_line(line: &str) -> bool {
    let t = line.trim();
    t.chars().count() >= 8
        && t.chars().filter(|c| matches!(c, '─' | '━' | '-')).count() * 10 >= t.chars().count() * 9
}

/// A prompt marker: the line the agent's own input box starts on.
fn is_prompt_marker(line: &str) -> bool {
    let t = line.trim_start();
    t.starts_with('›') || t.starts_with('❯') || t.starts_with("> ") || t == ">"
}

fn region_text(region: &Region, screen: &Screen) -> Option<String> {
    let lines = &screen.lines;
    let non_empty: Vec<&str> = lines
        .iter()
        .map(String::as_str)
        .filter(|l| !l.trim().is_empty())
        .collect();
    let text = match region {
        Region::OscTitle => screen.title.clone(),
        Region::WholeRecent => lines.join("\n"),
        Region::BottomNonEmpty(n) => {
            let start = non_empty.len().saturating_sub(*n);
            non_empty[start..].join("\n")
        }
        Region::TopNonEmpty(n) => non_empty[..(*n).min(non_empty.len())].join("\n"),
        Region::AfterLastHorizontalRule => {
            let at = lines.iter().rposition(|l| is_rule_line(l))?;
            lines[at + 1..].join("\n")
        }
        Region::PromptBoxBody => {
            // Between the last two horizontal rules: the input box's inside.
            let bottom = lines.iter().rposition(|l| is_rule_line(l))?;
            let top = lines[..bottom].iter().rposition(|l| is_rule_line(l))?;
            lines[top + 1..bottom].join("\n")
        }
        Region::LastNonEmptyAbovePromptBox => {
            let bottom = lines.iter().rposition(|l| is_rule_line(l))?;
            let top = lines[..bottom].iter().rposition(|l| is_rule_line(l))?;
            lines[..top]
                .iter()
                .rev()
                .find(|l| !l.trim().is_empty())?
                .clone()
        }
        Region::AfterLastPromptMarker => {
            let at = lines.iter().rposition(|l| is_prompt_marker(l))?;
            lines[at..].join("\n")
        }
        Region::BeforeCurrentPromptMarker => {
            let at = lines.iter().rposition(|l| is_prompt_marker(l))?;
            lines[..at].join("\n")
        }
        Region::WholeRecentWithoutCurrentPromptMarker => {
            let at = lines.iter().rposition(|l| is_prompt_marker(l))?;
            let mut v: Vec<&str> = lines[..at].iter().map(String::as_str).collect();
            v.extend(lines[at + 1..].iter().map(String::as_str));
            v.join("\n")
        }
        Region::Unsupported => return None,
    };
    Some(text)
}

impl Cond {
    fn is_empty(&self) -> bool {
        self.contains.is_empty()
            && self.regex.is_empty()
            && self.line_regex.is_empty()
            && self.any.is_empty()
            && self.all.is_empty()
            && self.not.is_empty()
    }

    /// Every matcher present must hold: all `contains` substrings (case-folded),
    /// all `regex` on the text, each `line_regex` on some line, one of `any`,
    /// all of `all`, none of `not`.
    fn holds(&self, text: &str) -> bool {
        let lower = text.to_lowercase();
        self.contains.iter().all(|s| lower.contains(s.as_str()))
            && self.regex.iter().all(|r| r.is_match(text))
            && self
                .line_regex
                .iter()
                .all(|r| text.lines().any(|l| r.is_match(l)))
            && (self.any.is_empty() || self.any.iter().any(|c| c.holds(text)))
            && self.all.iter().all(|c| c.holds(text))
            && !self.not.iter().any(|c| c.holds(text))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn screen(title: &str, body: &str) -> Screen {
        Screen {
            title: title.into(),
            lines: body.lines().map(str::to_owned).collect(),
        }
    }

    fn verdict(agent: &str, title: &str, body: &str) -> Verdict {
        classify(agent, &screen(title, body)).expect("a rule fires")
    }

    /// Explain a captured screen by hand, the way `herdr agent explain` does:
    /// `SCUTTLER_SCREEN=/path/to/capture.txt SCUTTLER_AGENT=claude
    /// SCUTTLER_TITLE='✳ name' cargo test --lib rules::tests::explain -- --ignored --nocapture`
    /// where the capture is `tmux capture-pane -p -t %N -S -40`.
    #[test]
    #[ignore = "a hand tool: reads SCUTTLER_SCREEN"]
    fn explain() {
        let path = std::env::var("SCUTTLER_SCREEN").expect("SCUTTLER_SCREEN=<capture file>");
        let agent = std::env::var("SCUTTLER_AGENT").unwrap_or_else(|_| "claude".into());
        let title = std::env::var("SCUTTLER_TITLE").unwrap_or_default();
        let body = std::fs::read_to_string(&path).expect("readable capture");
        let s = screen(&title, &body);
        let m = for_agent(&agent).expect("a known agent");
        for r in &m.rules {
            let fired = region_text(&r.region, &s)
                .map(|t| !r.cond.is_empty() && r.cond.holds(&t))
                .unwrap_or(false);
            println!(
                "{:>5} {:28} {:?}{}",
                r.priority,
                r.id,
                r.state,
                if fired { "  <- fires" } else { "" }
            );
        }
        println!("verdict: {:?}", m.classify(&s));
    }

    #[test]
    fn every_bundled_file_parses_and_every_pattern_compiles() {
        for (name, src) in BUNDLED {
            let m = parse(src).unwrap_or_else(|e| panic!("{name}: {e}"));
            assert_eq!(&m.id, name, "file name and id agree");
            assert!(!m.rules.is_empty(), "{name} has rules");
        }
        assert_eq!(
            known_agents().len(),
            BUNDLED.len(),
            "no rule file was dropped"
        );
    }

    // Claude Code, as captured on Mitch's panes 2026-11-06 (JOURNAL).

    const CLAUDE_FOOTER: &str = "\
  ~/Developer/mitch/scuttler  main Fable 5.1  ctx:84%  5h:32%
  ⏵⏵ auto mode on (shift+tab to cycle) · ← 2 agents";

    #[test]
    fn claude_activity_line_is_working() {
        let body = format!(
            "⏺ Showing more of the working pane's bottom\n  ⎿  $ tmux capture-pane\n✻ Precipitating… (1m 50s · ↓ 6.8k tokens · thought for 4s)\n\n{}\n❯ \n{}\n{CLAUDE_FOOTER}",
            "─".repeat(80),
            "─".repeat(80)
        );
        let v = verdict("claude", "✳ Scuttler", &body);
        assert_eq!(v.state, Some(State::Working));
        assert_eq!(v.rule, "live_turn_working");
    }

    #[test]
    fn claude_bare_prompt_box_is_idle_whatever_the_title_says() {
        // PR608, 25 h silent: the cell read "needs you" from a hook; the screen
        // is a bare prompt. Titles read ✳ on this setup whether working or not.
        let body = format!(
            "⏺ Done.\n\n{}\n❯ \n{}\n{CLAUDE_FOOTER}",
            "─".repeat(80),
            "─".repeat(80)
        );
        let v = verdict("claude", "✳ PR608", &body);
        assert_eq!(v.state, Some(State::Idle));
    }

    #[test]
    fn claude_question_form_is_blocked() {
        let body = format!(
            "⏺ Which approach?\n{}\n Which library should we use?\n\n ❯ 1. date-fns\n   2. dayjs\n\n Enter to select · ↑/↓ to navigate · Esc to cancel\n",
            "─".repeat(80)
        );
        let v = verdict("claude", "✳ PR608", &body);
        assert_eq!(v.state, Some(State::Blocked));
        assert_eq!(v.rule, "live_blocked_form");
    }

    #[test]
    fn claude_bash_permission_is_blocked() {
        let body = format!(
            "{}\n Bash command\n\n   rm -rf dist\n   Clean the build\n\n Do you want to proceed?\n ❯ 1. Yes\n   2. Yes, and don't ask again for: rm -rf dist\n   3. No\n\n Esc to cancel · Tab to amend\n",
            "─".repeat(80)
        );
        let v = verdict("claude", "✳ PR608", &body);
        assert_eq!(v.state, Some(State::Blocked));
        assert_eq!(v.rule, "bash_permission_prompt");
    }

    #[test]
    fn claude_transcript_viewer_says_nothing() {
        let body = "⏺ earlier output\n\n Showing detailed transcript · ctrl+o to toggle\n";
        let v = verdict("claude", "✳ PR608", body);
        assert_eq!(v.state, None, "an overlay keeps the previous state");
        assert_eq!(v.rule, "transcript_viewer");
    }

    #[test]
    fn claude_nothing_recognisable_is_no_verdict() {
        assert!(classify("claude", &screen("", "just some shell output\n$ ")).is_none());
    }

    // Codex, from its documented shapes.

    #[test]
    fn codex_action_required_title_is_blocked() {
        let v = verdict("codex", "Action Required · codex", "› \n");
        assert_eq!(v.state, Some(State::Blocked));
    }

    #[test]
    fn codex_approval_after_the_prompt_marker_is_blocked() {
        let body = "• ran a tool\n› \n Allow command?\n   ▶ Yes\n     No\n press enter to confirm or esc to cancel\n";
        let v = verdict("codex", "codex", body);
        assert_eq!(v.state, Some(State::Blocked));
        assert_eq!(v.rule, "live_strong_blocker");
    }

    #[test]
    fn codex_spinner_title_is_working() {
        let v = verdict("codex", "⠋ codex", "› ");
        assert_eq!(v.state, Some(State::Working));
    }

    #[test]
    fn unknown_agent_has_no_verdict() {
        assert!(classify("vim", &screen("", "~\n~\n")).is_none());
    }

    #[test]
    fn process_names_resolve_to_agents() {
        assert_eq!(agent_for_command("claude"), Some("claude"));
        assert_eq!(
            agent_for_command("/usr/local/bin/cursor-agent"),
            Some("cursor")
        );
        assert_eq!(agent_for_command("zsh"), None);
        assert!(is_interpreter("node"));
        assert_eq!(
            agent_for_argv("node /Users/x/.local/share/pnpm/bin/codex --model o3"),
            Some("codex")
        );
        assert_eq!(agent_for_argv("node server.js --name claude"), None);
    }

    #[test]
    fn regions_cut_where_they_say() {
        let s = screen("t", "a\n────────────\nbody line\n────────────\nfooter");
        assert_eq!(
            region_text(&Region::PromptBoxBody, &s).unwrap(),
            "body line"
        );
        assert_eq!(
            region_text(&Region::AfterLastHorizontalRule, &s).unwrap(),
            "footer"
        );
        assert_eq!(
            region_text(&Region::LastNonEmptyAbovePromptBox, &s).unwrap(),
            "a"
        );
        assert_eq!(
            region_text(&Region::BottomNonEmpty(2), &s).unwrap(),
            "────────────\nfooter"
        );
        assert!(region_text(&Region::Unsupported, &s).is_none());
    }
}
