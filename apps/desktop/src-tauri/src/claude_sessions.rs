//! Claude Code's own report of its sessions: a second signal beside the screen
//! (agents.rs, DECISIONS 2026-11-27).
//!
//! Claude Code keeps `<config>/sessions/<pid>.json` per running session, with
//! `status` (`busy` | `idle` | `shell`), `statusUpdatedAt` (ms), `sessionId`,
//! `pid`, `cwd` and `tmux` (`session:@window.%pane`). Its transcript,
//! `<config>/projects/<cwd, / and . as ->/<sessionId>.jsonl`, says when a turn
//! ended. Both formats are private and undocumented (observed on 2.1.332), so
//! everything here is lenient: an unknown status, a missing field or a file
//! that doesn't parse is no opinion, never an error. Only `*.json` is opened in
//! the sessions folder: the `.key` files beside them are not ours to read.
//!
//! Cost: one directory listing and a stat per file on the agents tick; a file
//! is re-parsed only when its size or mtime changes, and a transcript is read
//! only from where the last read stopped. Nothing resident, no watcher.

use std::{
    collections::HashMap,
    fs,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    time::SystemTime,
};

use serde::Deserialize;

/// What Claude says its session is doing. `shell` and anything unknown are
/// not represented: they carry no opinion about working vs idle.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Status {
    Busy,
    Idle,
}

/// One session file, as much of it as we use.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClaudeSession {
    pub pid: u32,
    pub session_id: String,
    pub cwd: String,
    /// The session's name as Claude shows it (`/rename`, or its own), when set.
    pub name: Option<String>,
    pub status: Option<Status>,
    /// Unix seconds `status` was last set; 0 when the file doesn't say.
    pub status_at: u64,
    /// The tmux pane id (`%208`), when the session runs in tmux.
    pub pane: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawSession {
    pid: Option<u32>,
    session_id: Option<String>,
    #[serde(default)]
    cwd: String,
    name: Option<String>,
    status: Option<String>,
    status_updated_at: Option<u64>,
    tmux: Option<String>,
}

/// Parse one session file; None when it isn't a session we can use.
pub fn parse_session(json: &str) -> Option<ClaudeSession> {
    let raw: RawSession = serde_json::from_str(json).ok()?;
    let status = match raw.status.as_deref() {
        Some("busy") => Some(Status::Busy),
        Some("idle") => Some(Status::Idle),
        _ => None,
    };
    Some(ClaudeSession {
        pid: raw.pid?,
        session_id: raw.session_id.filter(|s| !s.is_empty())?,
        cwd: raw.cwd,
        name: raw
            .name
            .map(|n| n.trim().to_owned())
            .filter(|n| !n.is_empty()),
        status,
        status_at: raw.status_updated_at.map_or(0, |ms| ms / 1000),
        pane: raw.tmux.as_deref().and_then(pane_of),
    })
}

/// The pane id in Claude's `tmux` field (`gogogo:@208.%208` → `%208`).
pub fn pane_of(tmux: &str) -> Option<String> {
    let pane = tmux.rsplit('.').next()?;
    let ok =
        pane.len() > 1 && pane.starts_with('%') && pane[1..].chars().all(|c| c.is_ascii_digit());
    ok.then(|| pane.to_owned())
}

/// Claude's config dir: `CLAUDE_CONFIG_DIR`, else `~/.claude`.
pub fn config_dir() -> Option<PathBuf> {
    match std::env::var_os("CLAUDE_CONFIG_DIR") {
        Some(dir) if !dir.is_empty() => Some(PathBuf::from(dir)),
        _ => dirs::home_dir().map(|h| h.join(".claude")),
    }
}

/// Where a session's transcript lives under `config`.
pub fn transcript_path(config: &Path, cwd: &str, session_id: &str) -> PathBuf {
    let slug: String = cwd
        .chars()
        .map(|c| if c == '/' || c == '.' { '-' } else { c })
        .collect();
    config
        .join("projects")
        .join(slug)
        .join(format!("{session_id}.jsonl"))
}

type Stamp = (u64, Option<SystemTime>);

/// The session files, re-parsed only when they change.
#[derive(Default)]
pub struct Scanner {
    files: HashMap<PathBuf, (Stamp, Option<ClaudeSession>)>,
}

impl Scanner {
    /// Every usable session in `dir` (`<config>/sessions`). A missing dir is
    /// an empty list: Claude Code isn't installed, or nothing runs.
    pub fn scan(&mut self, dir: &Path) -> Vec<ClaudeSession> {
        let Ok(entries) = fs::read_dir(dir) else {
            self.files.clear();
            return Vec::new();
        };
        let mut seen = HashMap::new();
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            let Ok(meta) = entry.metadata() else { continue };
            let stamp = (meta.len(), meta.modified().ok());
            let parsed = match self.files.remove(&path) {
                Some((old, parsed)) if old == stamp => parsed,
                _ => fs::read_to_string(&path)
                    .ok()
                    .and_then(|s| parse_session(&s)),
            };
            seen.insert(path, (stamp, parsed));
        }
        self.files = seen;
        let mut out: Vec<ClaudeSession> =
            self.files.values().filter_map(|(_, s)| s.clone()).collect();
        out.sort_by_key(|s| s.pid);
        out
    }
}

/// How the last turn ended, when it did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TurnEnd {
    /// The assistant finished: `stop_reason: "end_turn"`.
    EndTurn,
    /// The turn died on an API error.
    ApiError,
    /// The user pressed Esc: `[Request interrupted by user…`.
    Interrupted,
}

impl TurnEnd {
    pub fn label(self) -> &'static str {
        match self {
            TurnEnd::EndTurn => "end_turn",
            TurnEnd::ApiError => "api error",
            TurnEnd::Interrupted => "interrupted",
        }
    }
}

/// What the transcript's last real message says: the turn ended (and how),
/// or it's still open. None when no real message has been seen.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tail {
    Ended(TurnEnd),
    Open,
}

/// What a transcript has told us so far: the turn verdict and the context
/// the last assistant message used (input + cache tokens).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct TailState {
    pub tail: Option<Tail>,
    pub tokens: Option<u64>,
}

/// Context used, as a percentage of the window. The transcript doesn't name
/// the window, so it's 200k until the count passes that, then 1M: a 1M
/// session reads high until it's past 200k (an approximation, documented).
pub fn context_pct(tokens: u64) -> u8 {
    let window = if tokens > 200_000 { 1_000_000 } else { 200_000 };
    (tokens.saturating_mul(100) / window).min(100) as u8
}

/// Fold transcript lines into a tail state: the verdict (`fold_tail`) and the
/// last real assistant message's context tokens.
pub fn fold_state(prev: TailState, lines: &str) -> TailState {
    let mut tokens = prev.tokens;
    for line in lines.lines() {
        let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        if v.get("type").and_then(|t| t.as_str()) != Some("assistant")
            || v.get("isSidechain").and_then(|b| b.as_bool()) == Some(true)
        {
            continue;
        }
        let Some(usage) = v.pointer("/message/usage") else {
            continue;
        };
        let n = |k: &str| usage.get(k).and_then(|x| x.as_u64()).unwrap_or(0);
        let total =
            n("input_tokens") + n("cache_creation_input_tokens") + n("cache_read_input_tokens");
        if total > 0 {
            tokens = Some(total);
        }
    }
    TailState {
        tail: fold_tail(prev.tail, lines),
        tokens,
    }
}

/// Fold transcript lines into the tail verdict, starting from `prev`. Real
/// messages are `user` and `assistant` lines that are neither sidechain nor
/// meta; everything else (attachments, titles, summaries, api records) and any
/// line that doesn't parse is skipped.
pub fn fold_tail(prev: Option<Tail>, lines: &str) -> Option<Tail> {
    let mut tail = prev;
    for line in lines.lines() {
        let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        if v.get("isSidechain").and_then(|b| b.as_bool()) == Some(true)
            || v.get("isMeta").and_then(|b| b.as_bool()) == Some(true)
        {
            continue;
        }
        match v.get("type").and_then(|t| t.as_str()) {
            Some("assistant") => {
                if v.get("isApiErrorMessage").and_then(|b| b.as_bool()) == Some(true) {
                    tail = Some(Tail::Ended(TurnEnd::ApiError));
                } else if v.pointer("/message/stop_reason").and_then(|s| s.as_str())
                    == Some("end_turn")
                {
                    tail = Some(Tail::Ended(TurnEnd::EndTurn));
                } else {
                    tail = Some(Tail::Open);
                }
            }
            Some("user") => {
                tail = Some(if user_interrupted(&v) {
                    Tail::Ended(TurnEnd::Interrupted)
                } else {
                    Tail::Open
                });
            }
            _ => {}
        }
    }
    tail
}

/// A user line whose text starts `[Request interrupted by user`.
fn user_interrupted(v: &serde_json::Value) -> bool {
    const MARK: &str = "[Request interrupted by user";
    let content = v.pointer("/message/content");
    if let Some(s) = content.and_then(|c| c.as_str()) {
        return s.starts_with(MARK);
    }
    content
        .and_then(|c| c.as_array())
        .and_then(|blocks| blocks.first())
        .and_then(|b| b.get("text"))
        .and_then(|t| t.as_str())
        .is_some_and(|t| t.starts_with(MARK))
}

/// The first read of a transcript starts this far from its end: enough for
/// the last turn, never the whole file.
const FIRST_READ: u64 = 64 * 1024;

/// Per-transcript read positions and verdicts, so each tick reads only what
/// was appended. A partial last line is kept back until it's complete.
#[derive(Default)]
pub struct Tails {
    files: HashMap<PathBuf, (u64, TailState)>,
}

impl Tails {
    /// The tail verdict for `path`, reading only new bytes. A file that shrank
    /// (rewritten) is read again from near its end.
    pub fn read(&mut self, path: &Path) -> Option<TailState> {
        let mut file = fs::File::open(path).ok()?;
        let len = file.metadata().ok()?.len();
        let (mut pos, mut tail, fresh) = match self.files.get(path) {
            Some(&(p, t)) if p <= len => (p, t, false),
            _ => (len.saturating_sub(FIRST_READ), TailState::default(), true),
        };
        if pos < len {
            file.seek(SeekFrom::Start(pos)).ok()?;
            let mut buf = Vec::new();
            file.take(len - pos).read_to_end(&mut buf).ok()?;
            // A fresh read that starts mid-file drops its partial first line.
            let start = if fresh && pos > 0 {
                buf.iter()
                    .position(|&b| b == b'\n')
                    .map_or(buf.len(), |i| i + 1)
            } else {
                0
            };
            // Only whole lines: a partial last one waits for the next read.
            let end = buf.iter().rposition(|&b| b == b'\n').map_or(0, |i| i + 1);
            if end > start {
                tail = fold_state(tail, &String::from_utf8_lossy(&buf[start..end]));
            }
            pos += end.max(start) as u64;
        }
        self.files.insert(path.to_path_buf(), (pos, tail));
        Some(tail)
    }

    /// Forget transcripts no live session points at.
    pub fn retain(&mut self, keep: &[PathBuf]) {
        self.files.retain(|p, _| keep.contains(p));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_files_parse_leniently() {
        let busy = r#"{"pid":33037,"sessionId":"013427e2","cwd":"/Users/m/x",
            "status":"busy","statusUpdatedAt":1795755550079,"tmux":"gogogo:@208.%208",
            "kind":"interactive","someFutureField":{"a":1}}"#;
        let s = parse_session(busy).unwrap();
        assert_eq!(s.pid, 33037);
        assert_eq!(s.session_id, "013427e2");
        assert_eq!(s.status, Some(Status::Busy));
        assert_eq!(s.status_at, 1_795_755_550);
        assert_eq!(s.pane.as_deref(), Some("%208"));
        assert_eq!(s.name, None);
        let named = r#"{"pid":1,"sessionId":"a","name":"  Scuttler "}"#;
        assert_eq!(
            parse_session(named).unwrap().name.as_deref(),
            Some("Scuttler")
        );
        let blank = r#"{"pid":1,"sessionId":"a","name":"  "}"#;
        assert_eq!(parse_session(blank).unwrap().name, None);

        let idle = r#"{"pid":1,"sessionId":"a","status":"idle"}"#;
        let s = parse_session(idle).unwrap();
        assert_eq!(s.status, Some(Status::Idle));
        assert_eq!(s.pane, None);
        assert_eq!(s.status_at, 0);

        let shell = r#"{"pid":1,"sessionId":"a","status":"shell"}"#;
        assert_eq!(parse_session(shell).unwrap().status, None);
        let unknown = r#"{"pid":1,"sessionId":"a","status":"thinking-hard"}"#;
        assert_eq!(parse_session(unknown).unwrap().status, None);

        assert!(parse_session("not json").is_none());
        assert!(parse_session(r#"{"sessionId":"a"}"#).is_none(), "no pid");
        assert!(parse_session(r#"{"pid":1,"sessionId":""}"#).is_none());
        assert!(parse_session(r#"{"pid":"1","sessionId":"a"}"#).is_none());
    }

    #[test]
    fn pane_ids_come_from_the_tmux_field() {
        assert_eq!(pane_of("gogogo:@209.%209").as_deref(), Some("%209"));
        assert_eq!(pane_of("%3").as_deref(), Some("%3"));
        assert_eq!(pane_of("gogogo:@209"), None);
        assert_eq!(pane_of("x.%"), None);
        assert_eq!(pane_of("x.%12a"), None);
        assert_eq!(pane_of(""), None);
    }

    #[test]
    fn transcripts_live_under_the_cwd_slug() {
        assert_eq!(
            transcript_path(Path::new("/h/.claude"), "/Users/m/a.b/c", "s1"),
            PathBuf::from("/h/.claude/projects/-Users-m-a-b-c/s1.jsonl")
        );
    }

    fn line(v: serde_json::Value) -> String {
        format!("{v}\n")
    }
    fn assistant(stop: &str) -> String {
        line(serde_json::json!({"type":"assistant","isSidechain":false,
            "message":{"role":"assistant","stop_reason":stop}}))
    }
    fn user(text: &str) -> String {
        line(serde_json::json!({"type":"user","isSidechain":false,
            "message":{"role":"user","content":text}}))
    }

    #[test]
    fn the_last_real_message_decides_the_tail() {
        let ended = format!("{}{}", user("hi"), assistant("end_turn"));
        assert_eq!(fold_tail(None, &ended), Some(Tail::Ended(TurnEnd::EndTurn)));

        let working = format!("{}{}", assistant("end_turn"), user("next"));
        assert_eq!(fold_tail(None, &working), Some(Tail::Open));

        let tool = format!("{}{}", user("go"), assistant("tool_use"));
        assert_eq!(fold_tail(None, &tool), Some(Tail::Open));

        let esc = format!(
            "{}{}",
            assistant("tool_use"),
            user("[Request interrupted by user]")
        );
        assert_eq!(
            fold_tail(None, &esc),
            Some(Tail::Ended(TurnEnd::Interrupted))
        );

        let esc_blocks = line(serde_json::json!({"type":"user","message":{"content":[
            {"type":"text","text":"[Request interrupted by user for tool use]"}]}}));
        assert_eq!(
            fold_tail(None, &esc_blocks),
            Some(Tail::Ended(TurnEnd::Interrupted))
        );

        let api = line(
            serde_json::json!({"type":"assistant","isApiErrorMessage":true,
            "message":{"stop_reason":"stop_sequence"}}),
        );
        assert_eq!(fold_tail(None, &api), Some(Tail::Ended(TurnEnd::ApiError)));
    }

    #[test]
    fn noise_lines_are_skipped() {
        let noise = [
            assistant("end_turn"),
            line(serde_json::json!({"type":"assistant","isSidechain":true,
                "message":{"stop_reason":"tool_use"}})),
            line(serde_json::json!({"type":"user","isMeta":true,"message":{"content":"x"}})),
            line(serde_json::json!({"type":"summary","summary":"s"})),
            line(serde_json::json!({"type":"attachment"})),
            line(serde_json::json!({"type":"ai-title","title":"t"})),
            "{not json\n".to_owned(),
        ]
        .concat();
        assert_eq!(fold_tail(None, &noise), Some(Tail::Ended(TurnEnd::EndTurn)));
        assert_eq!(fold_tail(None, ""), None);
        assert_eq!(
            fold_tail(Some(Tail::Open), &line(serde_json::json!({"type":"mode"}))).unwrap(),
            Tail::Open,
            "nothing real keeps the previous verdict"
        );
    }

    #[test]
    fn context_comes_from_the_last_assistant_usage() {
        let used = |input: u64, cache: u64| {
            line(
                serde_json::json!({"type":"assistant","message":{"stop_reason":"tool_use",
                "usage":{"input_tokens":input,"cache_creation_input_tokens":0,
                "cache_read_input_tokens":cache,"output_tokens":300}}}),
            )
        };
        let side = line(serde_json::json!({"type":"assistant","isSidechain":true,
            "message":{"usage":{"input_tokens":190000}}}));
        let st = fold_state(
            TailState::default(),
            &format!("{}{}{}", used(2, 50_000), used(2, 120_000), side),
        );
        assert_eq!(
            st.tokens,
            Some(120_002),
            "the last real one, not the sidechain"
        );
        assert_eq!(st.tail, Some(Tail::Open));
        assert_eq!(
            fold_state(st, &user("next")).tokens,
            Some(120_002),
            "kept across lines without usage"
        );
        assert_eq!(context_pct(120_000), 60);
        assert_eq!(context_pct(170_000), 85);
        assert_eq!(context_pct(480_000), 48, "past 200k the window is 1M");
        assert_eq!(context_pct(5_000_000), 100);
    }

    fn tempdir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "scuttler-claude-{name}-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn tails_read_only_appended_bytes_and_wait_for_whole_lines() {
        use std::io::Write;
        let dir = tempdir("tail");
        let path = dir.join("s.jsonl");
        fs::write(&path, format!("{}{}", user("go"), assistant("tool_use"))).unwrap();
        let mut tails = Tails::default();
        assert_eq!(tails.read(&path).and_then(|t| t.tail), Some(Tail::Open));

        // Half a line: not read yet.
        let done = assistant("end_turn");
        let (a, b) = done.split_at(10);
        let mut f = fs::OpenOptions::new().append(true).open(&path).unwrap();
        f.write_all(a.as_bytes()).unwrap();
        assert_eq!(tails.read(&path).and_then(|t| t.tail), Some(Tail::Open));
        f.write_all(b.as_bytes()).unwrap();
        assert_eq!(
            tails.read(&path).and_then(|t| t.tail),
            Some(Tail::Ended(TurnEnd::EndTurn))
        );
        // Nothing new: same verdict, no re-read.
        assert_eq!(
            tails.read(&path).and_then(|t| t.tail),
            Some(Tail::Ended(TurnEnd::EndTurn))
        );

        // Rewritten shorter: read again.
        fs::write(&path, user("fresh")).unwrap();
        assert_eq!(tails.read(&path).and_then(|t| t.tail), Some(Tail::Open));

        assert_eq!(tails.read(&dir.join("missing.jsonl")), None);
        tails.retain(&[]);
        assert!(tails.files.is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_long_transcript_is_read_from_near_its_end() {
        let dir = tempdir("long");
        let path = dir.join("s.jsonl");
        let filler = user("x".repeat(200).as_str());
        let mut body = String::new();
        while body.len() < (FIRST_READ as usize) * 3 {
            body.push_str(&filler);
        }
        body.push_str(&assistant("end_turn"));
        fs::write(&path, body).unwrap();
        let mut tails = Tails::default();
        assert_eq!(
            tails.read(&path).and_then(|t| t.tail),
            Some(Tail::Ended(TurnEnd::EndTurn))
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_scanner_reads_json_only_and_reparses_on_change() {
        let dir = tempdir("scan");
        fs::write(
            dir.join("10.json"),
            r#"{"pid":10,"sessionId":"a","status":"busy","tmux":"s:@1.%1"}"#,
        )
        .unwrap();
        fs::write(dir.join("10.abc.key"), "secret").unwrap();
        fs::write(dir.join("11.json"), "garbage").unwrap();
        let mut scanner = Scanner::default();
        let found = scanner.scan(&dir);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].status, Some(Status::Busy));
        assert!(
            !scanner
                .files
                .keys()
                .any(|p| p.extension().is_some_and(|e| e == "key")),
            "a .key file is never opened"
        );

        fs::write(
            dir.join("10.json"),
            r#"{"pid":10,"sessionId":"a","status":"idle"}"#,
        )
        .unwrap();
        assert_eq!(scanner.scan(&dir)[0].status, Some(Status::Idle));

        fs::remove_file(dir.join("10.json")).unwrap();
        assert!(scanner.scan(&dir).is_empty());
        assert!(scanner.scan(&dir.join("nope")).is_empty());
        let _ = fs::remove_dir_all(&dir);
    }
}
