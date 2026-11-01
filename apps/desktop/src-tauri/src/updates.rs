//! App-updates monitor (docs/plans/done/app-updates-plugin.md): a cached
//! report of what's outdated across every package manager installed on this
//! Mac — Homebrew, the App Store, pnpm, mise. (npm is deliberately absent:
//! its only globals are node's own bundled `npm`/`corepack`, which mise
//! manages; pnpm is the global JS package manager here.) Modelled on usage.rs: a
//! cached read plus a background refresh on a long TTL, so the 1 Hz bar
//! snapshot never blocks on a shell-out. Every check is the user's own
//! package manager doing what it already does on `brew outdated` — no
//! request scuttler makes on its own behalf (DECISIONS 2026-09-04) — with one
//! exception since 2026-09-16: the `scuttler` source (selfupdate.rs) reads the
//! public GitHub Releases feed, sending nothing about the user.

use std::collections::{BTreeMap, VecDeque};
use std::io::{BufRead, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

/// Each source is re-checked on its own interval: `CHEAP` for a check that
/// finishes in well under a second, `SLOW` (the ceiling) for one that costs
/// seconds of CPU or reaches someone else's rate-limited server.
const CHEAP: Duration = Duration::from_secs(5 * 60);
const SLOW: Duration = Duration::from_secs(30 * 60);
/// A source whose last check failed is retried this soon, whatever its
/// interval — a timeout on wake shouldn't sit in the bar for half an hour.
const ERROR_RETRY: Duration = Duration::from_secs(5 * 60);
/// A source's check command is killed if it runs longer than this.
const CHECK_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatesReport {
    /// Unix seconds of the last completed refresh; 0 = never run.
    pub generated_at: u64,
    /// A refresh is in flight (the cell/panel can show it).
    pub refreshing: bool,
    /// Only present sources (binary found on PATH), in table order.
    pub sources: Vec<UpdateSource>,
    /// The run in flight, or the last one finished; None until the first
    /// `upgrade`.
    pub upgrade: Option<UpgradeRun>,
    /// Jobs waiting behind `upgrade`, in the order they will run.
    pub queue: Vec<UpgradeJob>,
    /// Runs finished this session, oldest first, the last `RECENT_RUNS` —
    /// how the panel marks a row "upgraded" before the re-check removes it.
    pub recent: Vec<UpgradeRun>,
    /// Progress of the current batch: jobs enqueued since the runner was
    /// last idle, and how many of them have finished.
    pub batch: UpgradeBatch,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpgradeBatch {
    pub done: u32,
    pub total: u32,
    /// Of `done`, how many exited non-zero (a cancel is not a failure).
    pub failed: u32,
    /// Unix seconds the batch began — the UI picks this batch's runs out of
    /// `recent` by it.
    pub started_at: u64,
}

/// One thing to upgrade: a whole source (`item` None) or a single package
/// of it. `command` is what `/bin/sh -c` gets.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpgradeJob {
    pub source: String,
    pub item: Option<String>,
    pub command: String,
}

/// An upgrade running (or finished) inside the app rather than a terminal —
/// `upgrade()`. The panel polls this at 1 Hz and shows the tail.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpgradeRun {
    /// Source id.
    pub source: String,
    /// The package, when the job was one package rather than the source.
    pub item: Option<String>,
    pub command: String,
    pub started_at: u64,
    /// 0 while running.
    pub finished_at: u64,
    /// None while running or when killed by a signal (cancel).
    pub exit_code: Option<i32>,
    /// True once `cancel_upgrade` killed it.
    pub cancelled: bool,
    /// Last `TAIL_LINES` lines of stdout+stderr, in order.
    pub tail: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSource {
    pub id: String,
    pub label: String,
    pub upgrade_command: String,
    /// Unix seconds; 0 if this source's first check hasn't finished.
    pub checked_at: u64,
    /// Last non-empty stderr line, or a timeout message; None while healthy.
    pub error: Option<String>,
    /// Outdated and pending. When `dismissed` is non-empty, `upgrade_command`
    /// is these packages' own commands joined with ` && ` (empty when none
    /// is pending) so a bulk upgrade leaves the dismissed ones alone.
    pub items: Vec<UpdateItem>,
    /// Outdated packages the user put aside (`dismiss`), out of the count
    /// until their `dismissed_until` or a newer version. Empty in the raw
    /// report; `apply_dismissals` fills it on read.
    #[serde(default)]
    pub dismissed: Vec<UpdateItem>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateItem {
    pub name: String,
    pub installed: String,
    pub available: String,
    pub kind: Option<String>,
    /// The command that upgrades this one package (`brew upgrade gcc`,
    /// `mas upgrade 409183694`) — what a click on its row runs.
    pub upgrade_command: String,
    /// Unix seconds the dismissal lapses; 0 on a pending package.
    #[serde(default)]
    pub dismissed_until: u64,
}

static REPORT: Mutex<Option<UpdatesReport>> = Mutex::new(None);
static REFRESHING: AtomicBool = AtomicBool::new(false);

/// The panel-owned upgrade runner: one child at a time, a queue behind it,
/// the finished runs of this session. Kept apart from REPORT so a refresh
/// landing mid-upgrade never clobbers the tail.
struct Runner {
    /// The run in flight (or the last finished) plus the child's pid while
    /// it runs (for `cancel_upgrade`).
    current: Option<(UpgradeRun, Option<u32>)>,
    queue: VecDeque<UpgradeJob>,
    recent: Vec<UpgradeRun>,
    batch: UpgradeBatch,
}

static RUNNER: Mutex<Runner> = Mutex::new(Runner {
    current: None,
    queue: VecDeque::new(),
    recent: Vec::new(),
    batch: UpgradeBatch {
        done: 0,
        total: 0,
        failed: 0,
        started_at: 0,
    },
});
/// Lines of output kept per run — enough to see what brew is doing.
const TAIL_LINES: usize = 40;
/// Finished runs remembered for the panel's "upgraded" marks.
const RECENT_RUNS: usize = 40;

impl Runner {
    fn running(&self) -> bool {
        matches!(self.current.as_ref(), Some((run, _)) if run.finished_at == 0)
    }

    /// Whether `job` is already in flight or waiting — a second click on the
    /// same row must not run it twice.
    fn holds(&self, job: &UpgradeJob) -> bool {
        let same = |run: &UpgradeRun| run.source == job.source && run.item == job.item;
        (self.running() && self.current.as_ref().is_some_and(|(run, _)| same(run)))
            || self.queue.iter().any(|q| q == job)
    }

    /// Queue `jobs`, starting a new batch when the runner is idle. Returns
    /// how many were new.
    fn enqueue(&mut self, jobs: Vec<UpgradeJob>) -> u32 {
        if !self.running() && self.queue.is_empty() {
            self.batch = UpgradeBatch {
                started_at: now_secs(),
                ..Default::default()
            };
        }
        let mut added = 0;
        for job in jobs {
            if self.holds(&job) {
                continue;
            }
            self.queue.push_back(job);
            added += 1;
        }
        self.batch.total += added;
        added
    }

    /// Record the current run as finished and remember it.
    fn finish(&mut self, exit_code: Option<i32>) {
        if let Some((run, pid)) = self.current.as_mut() {
            run.finished_at = now_secs();
            run.exit_code = exit_code;
            *pid = None;
            self.batch.done += 1;
            if !run.cancelled && exit_code != Some(0) {
                self.batch.failed += 1;
            }
            crate::logbook::breadcrumb(
                "updates",
                &format!(
                    "upgrade {}{} finished: {}",
                    run.source,
                    run.item
                        .as_deref()
                        .map(|i| format!(" {i}"))
                        .unwrap_or_default(),
                    match (run.cancelled, run.exit_code) {
                        (true, _) => "cancelled".to_string(),
                        (false, Some(c)) => format!("exit {c}"),
                        (false, None) => "killed".to_string(),
                    }
                ),
            );
            self.recent.push(run.clone());
            if self.recent.len() > RECENT_RUNS {
                let drop_n = self.recent.len() - RECENT_RUNS;
                self.recent.drain(..drop_n);
            }
        }
    }

    fn push_tail(&mut self, line: String) {
        if let Some((run, _)) = self.current.as_mut() {
            run.tail.push(line);
            if run.tail.len() > TAIL_LINES {
                let drop_n = run.tail.len() - TAIL_LINES;
                run.tail.drain(..drop_n);
            }
        }
    }
}

/// Cached report now; kicks a background refresh of the due rows when never
/// run or any row is due. Never blocks — the bar's 1 Hz snapshot always
/// reads the cache.
pub fn report() -> UpdatesReport {
    if report_due(REPORT.lock().unwrap().as_ref(), now_secs()) {
        kick(false);
    }
    let mut r = effective().unwrap_or_default();
    r.refreshing = REFRESHING.load(Ordering::Relaxed);
    let runner = RUNNER.lock().unwrap();
    r.upgrade = runner.current.as_ref().map(|(run, _)| run.clone());
    r.queue = runner.queue.iter().cloned().collect();
    r.recent = runner.recent.clone();
    r.batch = runner.batch;
    r
}

/// Queue an upgrade to run inside the app: a whole source (`item` None), one
/// package of it, or `"all"` — every present package manager, one job each,
/// so a failure in one does not stop the rest. Jobs run one at a time in
/// order; a job already running or waiting is not queued twice. Each child
/// is `/bin/sh -c <command>` with the environment the checks get
/// (`check_env`), stdin closed so anything that wants a terminal (sudo for a
/// cask) fails fast instead of hanging, both streams merged into the run's
/// tail. The bar/panel read the runner through `report()`; when the queue
/// drains a re-check runs so the count drops. Err for an unknown source or
/// package.
pub fn upgrade(source: &str, item: Option<&str>) -> Result<(), String> {
    let jobs = jobs_for(source, item)?;
    if let Some(name) = item {
        // Upgrading a dismissed package by hand is the end of its dismissal.
        forget_dismissal(source, name);
    }
    let mut runner = RUNNER.lock().unwrap();
    let added = runner.enqueue(jobs);
    if added > 0 {
        crate::logbook::breadcrumb(
            "updates",
            &format!(
                "queued {added} upgrade job(s): {source}{}",
                item.map(|i| format!(" {i}")).unwrap_or_default()
            ),
        );
    }
    pump(&mut runner);
    Ok(())
}

/// The jobs an `upgrade` request expands to.
fn jobs_for(source: &str, item: Option<&str>) -> Result<Vec<UpgradeJob>, String> {
    if source == "all" {
        // The package managers only: the app's own update relaunches, which
        // would cut a batch short — it is one click on its own row.
        let mut jobs = Vec::new();
        for def in SOURCES.iter().filter(|def| locate(def.binary).is_some()) {
            jobs.extend(jobs_for(def.id, None)?);
        }
        return Ok(jobs);
    }
    if item.is_none() {
        if let Some(src) = dismissal_aware(source) {
            // Some of this manager's packages are dismissed, and its bare
            // command would upgrade them too — so one job per pending
            // package instead (none when every outdated package is dismissed).
            return Ok(src
                .items
                .iter()
                .map(|i| UpgradeJob {
                    source: source.to_owned(),
                    item: Some(i.name.clone()),
                    command: i.upgrade_command.clone(),
                })
                .collect());
        }
    }
    let command = match item {
        // The app row is one item that is the source: either way, selfupdate.
        Some(_) if source == crate::selfupdate::SOURCE_ID => upgrade_command(source),
        Some(name) => item_command(source, name),
        None => upgrade_command(source),
    }
    .ok_or_else(|| match item {
        Some(name) => format!("unknown package {name} in {source}"),
        None => format!("unknown update source: {source}"),
    })?;
    Ok(vec![UpgradeJob {
        source: source.to_owned(),
        item: item
            .filter(|_| source != crate::selfupdate::SOURCE_ID)
            .map(str::to_owned),
        command,
    }])
}

/// Start the next queued job if nothing is running. Called with the runner
/// locked; the child's completion thread calls it again.
fn pump(runner: &mut Runner) {
    if runner.running() {
        return;
    }
    let Some(job) = runner.queue.pop_front() else {
        return;
    };
    if job.source == crate::selfupdate::SOURCE_ID {
        start_selfupdate(runner, job);
        return;
    }
    let mut cmd = Command::new("/bin/sh");
    cmd.args(["-c", &job.command])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        // Quiet brew's post-run advice; the tail is short.
        .env("HOMEBREW_NO_ENV_HINTS", "1");
    for (k, v) in check_env(Path::new("/bin/sh")) {
        cmd.env(k, v);
    }
    let run = UpgradeRun {
        source: job.source.clone(),
        item: job.item.clone(),
        command: job.command.clone(),
        started_at: now_secs(),
        ..Default::default()
    };
    crate::logbook::breadcrumb("updates", &format!("upgrade in panel: {}", job.command));
    let mut child = match cmd.spawn() {
        Ok(child) => child,
        Err(e) => {
            runner.current = Some((run, None));
            runner.push_tail(format!("spawn failed: {e}"));
            runner.finish(Some(127));
            pump(runner);
            return;
        }
    };
    runner.current = Some((run, Some(child.id())));
    let out_h = tail_lines(child.stdout.take());
    let err_h = tail_lines(child.stderr.take());
    std::thread::spawn(move || {
        let status = child.wait();
        let _ = out_h.join();
        let _ = err_h.join();
        let mut runner = RUNNER.lock().unwrap();
        runner.finish(status.ok().and_then(|s| s.code()));
        pump(&mut runner);
        let drained = !runner.running();
        drop(runner);
        if drained {
            kick(true);
        }
    });
}

/// The app's own update: in-process, not a shell — download → verify → swap
/// → relaunch (selfupdate.rs). The run's tail carries the steps; `x` cannot
/// cancel it (a half-swapped bundle is worse than a finished one).
fn start_selfupdate(runner: &mut Runner, job: UpgradeJob) {
    runner.current = Some((
        UpgradeRun {
            source: job.source,
            item: None,
            command: "scuttler update".into(),
            started_at: now_secs(),
            ..Default::default()
        },
        None,
    ));
    crate::logbook::breadcrumb("updates", "upgrade scuttler in panel (selfupdate)");
    std::thread::spawn(|| {
        let push = |line: String| RUNNER.lock().unwrap().push_tail(line);
        let result = crate::selfupdate::install(&push);
        // Ok never returns: the process relaunched.
        if let Err(e) = result {
            push(format!("error: {e}"));
            let mut runner = RUNNER.lock().unwrap();
            runner.finish(Some(1));
            crate::logbook::breadcrumb("selfupdate", &format!("failed: {e}"));
            pump(&mut runner);
        }
    });
}

/// Kill the in-flight panel upgrade and drop everything queued behind it; a
/// no-op when nothing is running.
pub fn cancel_upgrade() {
    let mut runner = RUNNER.lock().unwrap();
    let dropped = runner.queue.len() as u32;
    runner.queue.clear();
    runner.batch.total = runner.batch.total.saturating_sub(dropped);
    if let Some((run, Some(pid))) = runner.current.as_mut() {
        run.cancelled = true;
        // SIGTERM via /bin/kill: no libc dep for one signal. brew forwards it
        // to whatever it's running.
        let _ = Command::new("/bin/kill")
            .args(["-TERM", &pid.to_string()])
            .status();
    }
}

/// Pipe → the run's tail, line by line as they arrive (so the panel sees
/// progress, not a dump at the end). Both streams feed the same tail.
fn tail_lines<R: Read + Send + 'static>(pipe: Option<R>) -> std::thread::JoinHandle<()> {
    std::thread::spawn(move || {
        let Some(pipe) = pipe else { return };
        for line in std::io::BufReader::new(pipe).lines().map_while(Result::ok) {
            let line = line.trim_end().to_owned();
            if line.is_empty() {
                continue;
            }
            RUNNER.lock().unwrap().push_tail(line);
        }
    })
}

/// Force a refresh now; a no-op while one is already in flight (`r` in the
/// panel, `touch triggers/plugin.updates`).
pub fn refresh() {
    kick(true);
}

/// After an upgrade is handed to the terminal the report is stale but we
/// can't see when the upgrade finishes — so re-check a couple of times on a
/// short fuse (brew takes a minute or two; a long cask install, longer)
/// instead of leaving the old count in the bar until the next interval.
pub fn refresh_after_upgrade() {
    std::thread::spawn(|| {
        for secs in [90, 300, 900] {
            std::thread::sleep(Duration::from_secs(secs));
            kick(true);
        }
    });
}

/// The shell command that upgrades one source (`SOURCES`' `upgrade_command`),
/// or — for `"all"` — every *present* source's command (binary locates, via
/// `locate`) joined with ` && ` in table order (the terminal hand-off's
/// shape; the in-app runner queues one job per source instead). A source
/// with dismissed packages contributes its pending packages' own commands
/// (nothing when none is pending). `None` for an unknown source id.
pub fn upgrade_command(source: &str) -> Option<String> {
    if source == crate::selfupdate::SOURCE_ID {
        return Some(crate::selfupdate::UPGRADE_COMMAND.to_string());
    }
    if source == "all" {
        let joined = SOURCES
            .iter()
            .filter(|def| locate(def.binary).is_some())
            .map(|def| match dismissal_aware(def.id) {
                Some(src) => src.upgrade_command,
                None => def.upgrade_command.to_owned(),
            })
            .filter(|cmd| !cmd.is_empty())
            .collect::<Vec<_>>()
            .join(" && ");
        return Some(joined);
    }
    if let Some(src) = dismissal_aware(source) {
        return Some(src.upgrade_command);
    }
    SOURCES
        .iter()
        .find(|def| def.id == source)
        .map(|def| def.upgrade_command.to_string())
}

/// The command that upgrades one package, read off the cached report (the
/// parsers compute it with the item). `None` when the source or the package
/// is not in the last report — a click on a stale row does nothing rather
/// than guessing.
pub fn item_command(source: &str, item: &str) -> Option<String> {
    let report = REPORT.lock().unwrap();
    report
        .as_ref()?
        .sources
        .iter()
        .find(|s| s.id == source)?
        .items
        .iter()
        .find(|i| i.name == item)
        .map(|i| i.upgrade_command.clone())
}

/// Kick the first scan at launch (lib.rs setup) so the cache is warm by the
/// time anything reads it.
pub fn start() {
    kick(true);
}

/// Refresh in the background: every present source when `force`, else only
/// the rows that are due (or new). No-op while a refresh is in flight.
fn kick(force: bool) {
    if REFRESHING.swap(true, Ordering::SeqCst) {
        return;
    }
    std::thread::spawn(move || {
        let prev = REPORT.lock().unwrap().clone();
        let report = scan(prev.as_ref(), force);
        if force || moved(prev.as_ref(), &report) {
            crate::logbook::breadcrumb("updates", &summary(&report));
        }
        *REPORT.lock().unwrap() = Some(report);
        REFRESHING.store(false, Ordering::SeqCst);
    });
}

/// How often a source is re-checked; zero (always due) for an unknown id.
fn interval(id: &str) -> Duration {
    if id == crate::selfupdate::SOURCE_ID {
        // One request to GitHub's unauthenticated API (60/hour per IP), for
        // releases that land days apart.
        return SLOW;
    }
    SOURCES
        .iter()
        .find(|def| def.id == id)
        .map_or(Duration::ZERO, |def| def.interval)
}

/// A row needs re-checking once its interval has passed, or `ERROR_RETRY`
/// after a failed check. Wall-clock seconds, not `Instant`: macOS's
/// monotonic clock stops during sleep, so a Mac that slept overnight would
/// otherwise keep serving last night's rows.
fn is_due(source: &UpdateSource, interval: Duration, now: u64) -> bool {
    let wait = if source.error.is_some() {
        interval.min(ERROR_RETRY)
    } else {
        interval
    };
    now.saturating_sub(source.checked_at) >= wait.as_secs()
}

fn report_due(cached: Option<&UpdatesReport>, now: u64) -> bool {
    cached.is_none_or(|r| r.sources.iter().any(|s| is_due(s, interval(&s.id), now)))
}

/// Whether any row's result (count or error) differs from the last report —
/// a five-minute cadence logs only what moved, not a line per tick.
fn moved(prev: Option<&UpdatesReport>, next: &UpdatesReport) -> bool {
    prev.is_none_or(|p| summary(p) != summary(next))
}

/// One log line per refresh that changed something — what it found
/// (`brew 3 · mas 0 · pnpm error: …`), without opening the panel.
fn summary(report: &UpdatesReport) -> String {
    let parts: Vec<String> = report
        .sources
        .iter()
        .map(|s| match &s.error {
            Some(e) => format!("{} error: {e}", s.id),
            None => format!("{} {}", s.id, s.items.len()),
        })
        .collect();
    if parts.is_empty() {
        "refreshed: no package managers found".to_string()
    } else {
        format!("refreshed: {}", parts.join(" · "))
    }
}

// ---- dismissals ----------------------------------------------------------

/// A package the user put aside for a while (`d` in the panel, "dismiss
/// 24h" on a failed row): out of the count, the cell and the card, listed
/// dim in the panel, until `until` — or until the manager offers a version
/// other than `available`, when the fix may have landed and the row comes
/// back on its own.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct Dismissal {
    available: String,
    until: u64,
}

/// Keyed `"<source>:<name>"`. Persisted whole as JSON in the state dir so a
/// dismissal survives a relaunch; a handful of entries at most.
type Dismissals = BTreeMap<String, Dismissal>;

static DISMISSALS: Mutex<Option<Dismissals>> = Mutex::new(None);

fn dismissals_path() -> PathBuf {
    crate::config::state_dir().join("updates-dismissed.json")
}

fn dismissal_key(source: &str, item: &str) -> String {
    format!("{source}:{item}")
}

/// Run `f` over the dismissals, read from disk on first use (an unreadable
/// file counts as none). Under `cargo test` they start empty and
/// `dismiss`/`restore` are never called: the tests must not read or write
/// this Mac's real state.
fn with_dismissals<T>(f: impl FnOnce(&mut Dismissals) -> T) -> T {
    let mut guard = DISMISSALS.lock().unwrap();
    let map = guard.get_or_insert_with(|| {
        if cfg!(test) {
            Dismissals::new()
        } else {
            load_dismissals(&dismissals_path())
        }
    });
    f(map)
}

fn load_dismissals(path: &Path) -> Dismissals {
    std::fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

/// Write-to-temp + rename (agents.rs's shape), lapsed entries dropped on the
/// way out.
fn save_dismissals(path: &Path, map: &mut Dismissals, now: u64) -> std::io::Result<()> {
    map.retain(|_, d| d.until > now);
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let json = serde_json::to_vec_pretty(map).map_err(std::io::Error::other)?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, json)?;
    std::fs::rename(&tmp, path)
}

/// Move each source's dismissed packages out of `items` into `dismissed`.
/// A dismissal holds while it has not lapsed and the manager still offers
/// the version it was made against. A source with any dismissed package
/// gets its pending packages' own commands as its `upgrade_command`, so
/// "upgrade all" (and `t`) leave the dismissed ones alone.
fn apply_dismissals(report: &mut UpdatesReport, map: &Dismissals, now: u64) {
    if map.is_empty() {
        return;
    }
    for source in &mut report.sources {
        let mut pending = Vec::new();
        source.dismissed.clear();
        for mut item in std::mem::take(&mut source.items) {
            match map.get(&dismissal_key(&source.id, &item.name)) {
                Some(d) if d.until > now && d.available == item.available => {
                    item.dismissed_until = d.until;
                    source.dismissed.push(item);
                }
                _ => pending.push(item),
            }
        }
        source.items = pending;
        if !source.dismissed.is_empty() {
            source.upgrade_command = source
                .items
                .iter()
                .map(|i| i.upgrade_command.as_str())
                .collect::<Vec<_>>()
                .join(" && ");
        }
    }
}

/// The cached report with dismissals applied — what every reader gets; None
/// before the first refresh.
fn effective() -> Option<UpdatesReport> {
    let mut r = REPORT.lock().unwrap().clone()?;
    let now = now_secs();
    with_dismissals(|map| apply_dismissals(&mut r, map, now));
    Some(r)
}

/// A source as the user sees it, only when some of it is dismissed — the
/// case where its bare command would do too much.
fn dismissal_aware(source: &str) -> Option<UpdateSource> {
    effective()?
        .sources
        .into_iter()
        .find(|s| s.id == source)
        .filter(|s| !s.dismissed.is_empty())
}

/// Put one outdated package aside for `secs` (`d` in the panel, "dismiss
/// 24h" on a failed row): out of the count, the cell and the card, listed
/// dim in the panel, until then — or until the manager offers a version
/// other than today's. Err for a package not in the last report, or when
/// the state file cannot be written.
pub fn dismiss(source: &str, item: &str, secs: u64) -> Result<(), String> {
    let available = REPORT
        .lock()
        .unwrap()
        .as_ref()
        .and_then(|r| r.sources.iter().find(|s| s.id == source))
        .and_then(|s| s.items.iter().find(|i| i.name == item))
        .map(|i| i.available.clone())
        .ok_or_else(|| format!("unknown package {item} in {source}"))?;
    let now = now_secs();
    with_dismissals(|map| {
        map.insert(
            dismissal_key(source, item),
            Dismissal {
                available,
                until: now + secs,
            },
        );
        save_dismissals(&dismissals_path(), map, now)
    })
    .map_err(|e| format!("could not save the dismissal: {e}"))?;
    crate::logbook::breadcrumb(
        "updates",
        &format!("dismissed {source} {item} for {}h", secs / 3600),
    );
    Ok(())
}

/// Bring a dismissed package back now (`↵` on its dim row). Ok, and
/// nothing done, when it was not dismissed.
pub fn restore(source: &str, item: &str) -> Result<(), String> {
    if forget_dismissal(source, item) {
        crate::logbook::breadcrumb("updates", &format!("restored {source} {item}"));
    }
    Ok(())
}

/// Drop a dismissal if there is one; true when there was. A save failure
/// only logs: the in-memory map is already right for this session.
fn forget_dismissal(source: &str, item: &str) -> bool {
    let now = now_secs();
    with_dismissals(|map| {
        if map.remove(&dismissal_key(source, item)).is_none() {
            return false;
        }
        if let Err(e) = save_dismissals(&dismissals_path(), map, now) {
            crate::logbook::breadcrumb("updates", &format!("could not save dismissals: {e}"));
        }
        true
    })
}

// ---- sources -----------------------------------------------------------

struct SourceDef {
    id: &'static str,
    label: &'static str,
    binary: &'static str,
    args: &'static [&'static str],
    upgrade_command: &'static str,
    parser: fn(&str) -> Result<Vec<UpdateItem>, String>,
    interval: Duration,
}

/// Table order from the plan; the report preserves it.
const SOURCES: &[SourceDef] = &[
    SourceDef {
        id: "brew",
        label: "Homebrew",
        binary: "brew",
        // ~3 s of Ruby per run; the other three take ~0.2 s.
        args: &["outdated", "--json=v2"],
        upgrade_command: "brew upgrade",
        parser: parse_brew,
        interval: SLOW,
    },
    SourceDef {
        id: "mas",
        label: "App Store",
        binary: "mas",
        args: &["outdated"],
        upgrade_command: "mas upgrade",
        parser: parse_mas,
        interval: CHEAP,
    },
    SourceDef {
        id: "pnpm",
        label: "pnpm",
        binary: "pnpm",
        args: &["outdated", "-g", "--json"],
        upgrade_command: "pnpm update -g",
        parser: parse_pnpm,
        interval: CHEAP,
    },
    SourceDef {
        id: "mise",
        label: "mise",
        binary: "mise",
        args: &["outdated", "--json"],
        upgrade_command: "mise upgrade",
        parser: parse_mise,
        interval: CHEAP,
    },
];

/// A report row: kept from the last report, or being checked on its thread.
enum Row {
    Kept(UpdateSource),
    Checking(std::thread::JoinHandle<UpdateSource>),
}

/// Every present source that is due (all of them when `force`, or with no
/// previous report) runs on its own thread, in parallel; the rest keep their
/// last row. The report is assembled once every check has finished (or timed
/// out), in table order.
fn scan(prev: Option<&UpdatesReport>, force: bool) -> UpdatesReport {
    let now = now_secs();
    let keep = |id: &str| {
        prev.and_then(|r| r.sources.iter().find(|s| s.id == id))
            .filter(|s| !force && !is_due(s, interval(id), now))
            .cloned()
    };
    let rows: Vec<Row> = SOURCES
        .iter()
        .filter_map(|def| locate(def.binary).map(|bin| (def, bin)))
        .map(|(def, bin)| match keep(def.id) {
            Some(row) => Row::Kept(row),
            None => Row::Checking(std::thread::spawn(move || check_source(def, &bin))),
        })
        .collect();
    let mut sources: Vec<UpdateSource> = Vec::new();
    // scuttler itself first (selfupdate.rs); absent from dev/unsigned builds
    // and when `config.updates.checkSelf` is off — off means no request.
    if crate::selfupdate::eligible() {
        sources.push(keep(crate::selfupdate::SOURCE_ID).unwrap_or_else(crate::selfupdate::check));
    }
    sources.extend(rows.into_iter().filter_map(|row| match row {
        Row::Kept(source) => Some(source),
        Row::Checking(handle) => handle.join().ok(),
    }));
    UpdatesReport {
        generated_at: now_secs(),
        sources,
        ..Default::default()
    }
}

/// Run one source's check command and turn the outcome into a report row.
/// pnpm exits non-zero when packages are outdated — that's not an error, so
/// the parser is tried on stdout regardless of exit status; a parse failure
/// (or a timeout) is what makes a source `error`.
fn check_source(def: &'static SourceDef, bin: &Path) -> UpdateSource {
    let (items, error) = match run_check(bin, def.args, CHECK_TIMEOUT) {
        Err(e) => (Vec::new(), Some(e)),
        Ok((stdout, stderr)) => match (def.parser)(&stdout) {
            Ok(items) => (items, None),
            Err(parse_err) => (
                Vec::new(),
                Some(last_nonempty_line(&stderr).unwrap_or(parse_err)),
            ),
        },
    };
    UpdateSource {
        id: def.id.into(),
        label: def.label.into(),
        upgrade_command: def.upgrade_command.into(),
        checked_at: now_secs(),
        error,
        items,
        dismissed: Vec::new(),
    }
}

/// Find `bin` on PATH or under Homebrew (deps.rs, shared with the desktop
/// deps rows), plus the homes deps.rs doesn't check (`extra_dirs`).
fn locate(bin: &str) -> Option<PathBuf> {
    if let Some(p) = crate::deps::locate(bin) {
        return Some(p);
    }
    extra_dirs()
        .into_iter()
        .map(|d| d.join(bin))
        .find(|p| crate::deps::is_executable(p))
}

/// Tool homes an accessory app's bare PATH doesn't carry: `~/.local/bin`
/// (pnpm's own installer) and mise's shim dir. Homebrew's bin dirs are
/// deps.rs's business (`deps::locate`) and `check_path` adds them too.
fn extra_dirs() -> Vec<PathBuf> {
    let Some(home) = dirs::home_dir() else {
        return Vec::new();
    };
    vec![
        home.join(".local/bin"),
        home.join(".local/share/mise/shims"),
    ]
}

/// Where pnpm keeps its globals: `$PNPM_HOME` when the app inherited one,
/// else the first of pnpm's own conventions that exists on disk —
/// `$XDG_DATA_HOME/pnpm`, `~/.local/share/pnpm`, `~/Library/pnpm` (its
/// macOS default). pnpm's global store is purely env-driven: without
/// `PNPM_HOME` it silently reads an empty default store and reports `{}`,
/// and it refuses to run global commands unless `$PNPM_HOME/bin` is on PATH.
fn pnpm_home() -> Option<PathBuf> {
    if let Some(home) = std::env::var_os("PNPM_HOME") {
        return Some(PathBuf::from(home));
    }
    let home = dirs::home_dir()?;
    let xdg = std::env::var_os("XDG_DATA_HOME").map(PathBuf::from);
    [
        xdg.map(|d| d.join("pnpm")),
        Some(home.join(".local/share/pnpm")),
        Some(home.join("Library/pnpm")),
    ]
    .into_iter()
    .flatten()
    .find(|d| d.is_dir())
}

/// The environment a check (or a panel upgrade) runs with: `check_path` plus
/// `PNPM_HOME` when one can be found.
fn check_env(bin: &Path) -> Vec<(&'static str, std::ffi::OsString)> {
    let mut env = vec![("PATH", check_path(bin))];
    if let Some(pnpm) = pnpm_home() {
        env.push(("PNPM_HOME", pnpm.into_os_string()));
    }
    env
}

/// The PATH a check runs with: the app's own PATH first, then Homebrew,
/// `extra_dirs` and pnpm's bin dir. Launched by its LaunchAgent the app
/// inherits the bare macOS PATH, and pnpm/npm are `#!/usr/bin/env node`
/// scripts — `locate` finds the script but `env` then can't find `node`
/// (JOURNAL 2026-09-10). The located binary's own dir goes in too so a
/// script finds its siblings.
fn check_path(bin: &Path) -> std::ffi::OsString {
    let mut paths: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default();
    if let Some(dir) = bin.parent() {
        paths.push(dir.to_path_buf());
    }
    paths.extend(crate::deps::BREW_BINS.iter().map(PathBuf::from));
    paths.extend(extra_dirs());
    if let Some(pnpm) = pnpm_home() {
        paths.push(pnpm.join("bin"));
    }
    std::env::join_paths(paths).unwrap_or_default()
}

// ---- running the check command ------------------------------------------

/// Run a child to completion or `timeout`, capturing both streams regardless
/// of exit status (unlike widgets::run — several of these tools exit
/// non-zero on a normal "there are updates" result). Both pipes drain on
/// their own threads so a chatty child can't wedge on a full pipe.
fn run_check(bin: &Path, args: &[&str], timeout: Duration) -> Result<(String, String), String> {
    let mut cmd = Command::new(bin);
    cmd.args(args);
    for (k, v) in check_env(bin) {
        cmd.env(k, v);
    }
    let mut child = cmd
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("spawn failed: {e}"))?;
    let out_h = drain(child.stdout.take());
    let err_h = drain(child.stderr.take());
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if started.elapsed() > timeout => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = out_h.join();
                let _ = err_h.join();
                return Err(format!("timed out after {}s", timeout.as_secs()));
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(20)),
            Err(e) => return Err(format!("wait failed: {e}")),
        }
    }
    Ok((
        out_h.join().unwrap_or_default(),
        err_h.join().unwrap_or_default(),
    ))
}

fn drain<R: Read + Send + 'static>(pipe: Option<R>) -> std::thread::JoinHandle<String> {
    std::thread::spawn(move || {
        let mut out = String::new();
        if let Some(mut p) = pipe {
            let _ = p.read_to_string(&mut out);
        }
        out
    })
}

fn last_nonempty_line(s: &str) -> Option<String> {
    s.lines()
        .rev()
        .find(|l| !l.trim().is_empty())
        .map(|l| l.trim().to_owned())
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

// ---- parsers -------------------------------------------------------------
//
// Pure functions of stdout so they're testable against captured output
// without spawning anything.

/// A package name as a `/bin/sh` word: bare when it is the plain shape every
/// package manager hands out (`gcc`, `beeper/tap/cli`, `npm:@openai/codex`,
/// `409183694`), single-quoted otherwise — the per-item commands are shown
/// to the user, so the common case stays readable.
fn sh_word(name: &str) -> String {
    let plain = !name.is_empty()
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "@/:._+-".contains(c));
    if plain {
        name.to_owned()
    } else {
        format!("'{}'", name.replace('\'', "'\\''"))
    }
}

/// `brew outdated --json=v2`: `formulae[]` + `casks[]`, each with `name`,
/// `installed_versions[0]`, `current_version`; pinned entries are skipped —
/// the user asked brew not to touch them.
fn parse_brew(stdout: &str) -> Result<Vec<UpdateItem>, String> {
    let v: serde_json::Value = serde_json::from_str(stdout).map_err(|e| e.to_string())?;
    let mut items = Vec::new();
    for (key, kind) in [("formulae", "formula"), ("casks", "cask")] {
        let entries = v
            .get(key)
            .and_then(|a| a.as_array())
            .map(|a| a.as_slice())
            .unwrap_or_default();
        for entry in entries {
            if entry.get("pinned").and_then(|p| p.as_bool()) == Some(true) {
                continue;
            }
            let name = entry
                .get("name")
                .and_then(|n| n.as_str())
                .unwrap_or_default();
            if name.is_empty() {
                continue;
            }
            let installed = entry
                .get("installed_versions")
                .and_then(|v| v.as_array())
                .and_then(|a| a.first())
                .and_then(|v| v.as_str())
                .unwrap_or_default();
            let available = entry
                .get("current_version")
                .and_then(|v| v.as_str())
                .unwrap_or_default();
            let upgrade_command = if kind == "cask" {
                format!("brew upgrade --cask {}", sh_word(name))
            } else {
                format!("brew upgrade {}", sh_word(name))
            };
            items.push(UpdateItem {
                name: name.to_owned(),
                installed: installed.to_owned(),
                available: available.to_owned(),
                kind: Some(kind.to_owned()),
                upgrade_command,
                dismissed_until: 0,
            });
        }
    }
    Ok(items)
}

/// `mas outdated`: one line per app, `<id> <Name> (<installed> -> <available>)`;
/// no output = nothing outdated. Names may contain spaces (and even "->"-like
/// dashes), so the id is taken as the first token and the version pair from
/// the last parenthesised group.
fn parse_mas(stdout: &str) -> Result<Vec<UpdateItem>, String> {
    let mut items = Vec::new();
    for line in stdout.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let bad = || format!("unparseable mas line: {line}");
        let (id, rest) = line.split_once(' ').ok_or_else(bad)?;
        let open = rest.rfind('(').ok_or_else(bad)?;
        let name = rest[..open].trim();
        let inner = rest[open + 1..].trim_end_matches(')').trim();
        let (installed, available) = inner.split_once("->").ok_or_else(bad)?;
        if name.is_empty() {
            return Err(bad());
        }
        items.push(UpdateItem {
            name: name.to_owned(),
            installed: installed.trim().to_owned(),
            available: available.trim().to_owned(),
            kind: None,
            upgrade_command: format!("mas upgrade {}", sh_word(id)),
            dismissed_until: 0,
        });
    }
    Ok(items)
}

/// `pnpm outdated -g --json`: stdout may open with a `[WARN] …` line before
/// the JSON object (observed on this machine, 2026-09-04) — parse from the
/// first `{`.
fn parse_pnpm(stdout: &str) -> Result<Vec<UpdateItem>, String> {
    let json = stdout
        .find('{')
        .map(|i| &stdout[i..])
        .ok_or("no JSON object in pnpm output")?;
    parse_keyed_versions(json, "pnpm update -g")
}

/// pnpm's shape: `{ "<name>": { "current": …, "latest": … } }`. pnpm's exit
/// code is not consulted — a non-zero exit with parseable JSON is the normal
/// "there are outdated packages" result, not an error.
fn parse_keyed_versions(json: &str, upgrade: &str) -> Result<Vec<UpdateItem>, String> {
    let v: serde_json::Value = serde_json::from_str(json).map_err(|e| e.to_string())?;
    let obj = v.as_object().ok_or("expected a JSON object")?;
    let mut items: Vec<UpdateItem> = obj
        .iter()
        .map(|(name, entry)| UpdateItem {
            name: name.clone(),
            installed: entry
                .get("current")
                .and_then(|s| s.as_str())
                .unwrap_or_default()
                .to_owned(),
            available: entry
                .get("latest")
                .and_then(|s| s.as_str())
                .unwrap_or_default()
                .to_owned(),
            kind: None,
            upgrade_command: format!("{upgrade} {}", sh_word(name)),
            dismissed_until: 0,
        })
        .collect();
    items.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(items)
}

/// `mise outdated --json`: `{ "<tool>": { "name", "current", "latest", … } }`
/// over every tool mise manages, not only outdated ones — so, unlike
/// pnpm, an entry only counts when `current` differs from `latest`.
fn parse_mise(stdout: &str) -> Result<Vec<UpdateItem>, String> {
    let v: serde_json::Value = serde_json::from_str(stdout).map_err(|e| e.to_string())?;
    let obj = v.as_object().ok_or("expected a JSON object")?;
    let mut items: Vec<UpdateItem> = obj
        .iter()
        .filter_map(|(key, entry)| {
            let name = entry
                .get("name")
                .and_then(|s| s.as_str())
                .unwrap_or(key)
                .to_owned();
            let installed = entry.get("current").and_then(|s| s.as_str())?.to_owned();
            let available = entry.get("latest").and_then(|s| s.as_str())?.to_owned();
            if installed == available {
                return None;
            }
            Some(UpdateItem {
                upgrade_command: format!("mise upgrade {}", sh_word(key)),
                name,
                installed,
                available,
                kind: None,
                dismissed_until: 0,
            })
        })
        .collect();
    items.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(items)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Runner tests share the one static RUNNER; they take this in turn.
    static RUNNER_TEST_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn parses_brew_outdated_json_v2() {
        let out = r#"{"formulae":[{"name":"gcc","installed_versions":["16.1.0"],"current_version":"16.2.0","pinned":false,"pinned_version":null}],"casks":[{"name":"repobar","installed_versions":["0.6.1"],"current_version":"0.8.7","pinned":false,"pinned_version":null}]}"#;
        let items = parse_brew(out).unwrap();
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].name, "gcc");
        assert_eq!(items[0].installed, "16.1.0");
        assert_eq!(items[0].available, "16.2.0");
        assert_eq!(items[0].kind.as_deref(), Some("formula"));
        assert_eq!(items[0].upgrade_command, "brew upgrade gcc");
        assert_eq!(items[1].name, "repobar");
        assert_eq!(items[1].kind.as_deref(), Some("cask"));
        assert_eq!(items[1].upgrade_command, "brew upgrade --cask repobar");
    }

    #[test]
    fn brew_skips_pinned_entries() {
        let out = r#"{"formulae":[{"name":"node","installed_versions":["20.0.0"],"current_version":"22.0.0","pinned":true,"pinned_version":"20.0.0"}],"casks":[]}"#;
        assert_eq!(parse_brew(out).unwrap(), Vec::new());
        assert!(parse_brew("not json").is_err());
    }

    #[test]
    fn parses_mas_lines() {
        // No outdated App Store apps on this Mac when this was written
        // (`mas outdated`, 2026-09-04) — the empty case is the live capture;
        // the populated case follows mas's documented
        // `<id> <Name> (<installed> -> <available>)` format, including a
        // name with spaces.
        assert_eq!(parse_mas("").unwrap(), Vec::new());
        assert_eq!(parse_mas("\n\n").unwrap(), Vec::new());
        let out = parse_mas(
            "409183694 Keynote (13.2 -> 14.0)\n497799835 Bear – Markdown Notes (2.1 -> 2.2)\n",
        )
        .unwrap();
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].name, "Keynote");
        assert_eq!(out[0].installed, "13.2");
        assert_eq!(out[0].available, "14.0");
        assert_eq!(out[0].upgrade_command, "mas upgrade 409183694");
        assert_eq!(out[1].name, "Bear – Markdown Notes");
        assert_eq!(out[1].installed, "2.1");
        assert_eq!(out[1].available, "2.2");
        assert!(parse_mas("not a mas line at all").is_err());
    }

    #[test]
    fn parses_pnpm_outdated_json() {
        // Captured on this machine, 2026-09-04: a WARN line before the JSON.
        let clean = "[WARN] Using --global skips the package manager check for this project\n{}";
        assert_eq!(parse_pnpm(clean).unwrap(), Vec::new());
        let with_items = r#"{"typescript":{"current":"5.5.0","latest":"5.6.2"}}"#;
        let items = parse_pnpm(with_items).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].name, "typescript");
        assert_eq!(items[0].installed, "5.5.0");
        assert_eq!(items[0].available, "5.6.2");
        assert_eq!(items[0].upgrade_command, "pnpm update -g typescript");
        assert!(parse_pnpm("no brace here").is_err());
    }

    #[test]
    fn parses_mise_outdated_json_and_filters_unchanged() {
        // Captured on this machine, 2026-09-04 (`mise outdated --json`).
        let out = r#"{"npm:@openai/codex":{"name":"npm:@openai/codex","requested":"latest","current":"0.149.1","bump":null,"latest":"0.152.1","source":{"type":"mise.toml","path":"/Users/mitch/.config/mise/config.toml"}}}"#;
        let items = parse_mise(out).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].name, "npm:@openai/codex");
        assert_eq!(items[0].installed, "0.149.1");
        assert_eq!(items[0].available, "0.152.1");
        assert_eq!(items[0].upgrade_command, "mise upgrade npm:@openai/codex");

        let unchanged = r#"{"node":{"name":"node","current":"24.0.0","latest":"24.0.0"}}"#;
        assert_eq!(parse_mise(unchanged).unwrap(), Vec::new());
    }

    #[test]
    fn run_check_reports_timeout() {
        let err =
            run_check(Path::new("/bin/sleep"), &["2"], Duration::from_millis(100)).unwrap_err();
        assert_eq!(err, "timed out after 0s");
    }

    #[test]
    fn run_check_captures_both_streams_regardless_of_exit_code() {
        // `sh -c 'echo out; echo err >&2; exit 1'` — a non-zero exit whose
        // stdout is still meaningful, exactly pnpm's shape.
        let (out, err) = run_check(
            Path::new("/bin/sh"),
            &["-c", "echo out; echo err >&2; exit 1"],
            Duration::from_secs(5),
        )
        .unwrap();
        assert_eq!(out.trim(), "out");
        assert_eq!(err.trim(), "err");
    }

    #[test]
    fn run_check_path_reaches_homebrew_and_the_binary_dir() {
        // The bug of 2026-09-10: the LaunchAgent-launched app ran pnpm with
        // the bare macOS PATH, and pnpm's `#!/usr/bin/env node` shebang died
        // with "env: node: No such file or directory". A check's PATH must
        // carry Homebrew, the tool's own dir, and the extra homes.
        let (out, _) = run_check(
            Path::new("/bin/sh"),
            &["-c", "echo $PATH"],
            Duration::from_secs(5),
        )
        .unwrap();
        let path = out.trim();
        assert!(path.split(':').any(|d| d == "/bin"), "{path}");
        assert!(path.split(':').any(|d| d == "/opt/homebrew/bin"), "{path}");
        let home = dirs::home_dir().unwrap();
        let local_bin = home.join(".local/bin");
        assert!(
            path.split(':').any(|d| d == local_bin.to_str().unwrap()),
            "{path}"
        );
    }

    #[test]
    fn run_check_hands_pnpm_its_home_when_one_can_be_found() {
        // Whatever `pnpm_home` resolves to on this machine (env or a
        // conventional dir) must reach the child as PNPM_HOME with its bin
        // dir on PATH — otherwise pnpm reads an empty default store.
        let (out, _) = run_check(
            Path::new("/bin/sh"),
            &["-c", "echo $PNPM_HOME; echo $PATH"],
            Duration::from_secs(5),
        )
        .unwrap();
        let mut lines = out.lines();
        let seen_home = lines.next().unwrap_or_default().trim().to_owned();
        let path = lines.next().unwrap_or_default().trim().to_owned();
        match pnpm_home() {
            Some(expected) => {
                assert_eq!(seen_home, expected.to_str().unwrap());
                let bin = expected.join("bin");
                assert!(
                    path.split(':').any(|d| d == bin.to_str().unwrap()),
                    "{path}"
                );
            }
            None => assert!(seen_home.is_empty()),
        }
    }

    /// Tests share one RUNNER: each one that touches it starts from idle.
    fn reset_runner() {
        let mut r = RUNNER.lock().unwrap();
        r.current = None;
        r.queue.clear();
        r.recent.clear();
        r.batch = UpgradeBatch::default();
    }

    fn job(source: &str, item: Option<&str>) -> UpgradeJob {
        UpgradeJob {
            source: source.into(),
            item: item.map(Into::into),
            command: format!("echo {source}"),
        }
    }

    #[test]
    fn tail_keeps_the_last_lines_only_both_streams_merged() {
        let _guard = RUNNER_TEST_LOCK.lock().unwrap();
        reset_runner();
        RUNNER.lock().unwrap().current = Some((UpgradeRun::default(), None));
        let many: String = (0..(TAIL_LINES + 5))
            .map(|i| format!("line {i}\n"))
            .collect();
        tail_lines(Some(std::io::Cursor::new(many.into_bytes())))
            .join()
            .unwrap();
        let tail = RUNNER
            .lock()
            .unwrap()
            .current
            .as_ref()
            .unwrap()
            .0
            .tail
            .clone();
        assert_eq!(tail.len(), TAIL_LINES);
        assert_eq!(tail[0], "line 5");
        assert_eq!(tail.last().unwrap(), &format!("line {}", TAIL_LINES + 4));
        reset_runner();
    }

    #[test]
    fn enqueue_starts_a_batch_when_idle_and_skips_duplicates() {
        let _guard = RUNNER_TEST_LOCK.lock().unwrap();
        reset_runner();
        let mut r = RUNNER.lock().unwrap();
        r.batch = UpgradeBatch {
            done: 3,
            total: 3,
            failed: 1,
            started_at: 1,
        };
        assert_eq!(
            r.enqueue(vec![job("brew", Some("gcc")), job("brew", Some("gcc"))]),
            1
        );
        assert_eq!((r.batch.done, r.batch.total, r.batch.failed), (0, 1, 0));
        assert!(r.batch.started_at > 1);
        // Pretend the first is running: more jobs join the same batch, and a
        // job equal to the running one is not queued again.
        let running = r.queue.pop_front().unwrap();
        r.current = Some((
            UpgradeRun {
                source: running.source,
                item: running.item,
                ..Default::default()
            },
            None,
        ));
        assert!(r.running());
        assert_eq!(
            r.enqueue(vec![job("brew", Some("gcc")), job("mas", None)]),
            1
        );
        assert_eq!((r.batch.done, r.batch.total), (0, 2));
        assert_eq!(r.queue.len(), 1);
        r.finish(Some(1));
        assert_eq!((r.batch.done, r.batch.failed), (1, 1));
        assert_eq!(r.recent.len(), 1);
        assert!(!r.running());
        drop(r);
        reset_runner();
    }

    #[test]
    fn upgrade_rejects_unknown_sources_and_packages() {
        let _guard = RUNNER_TEST_LOCK.lock().unwrap();
        reset_runner();
        assert!(upgrade("definitely-not-a-source", None).is_err());
        assert!(upgrade("brew", Some("not-in-the-report")).is_err());
        assert!(RUNNER.lock().unwrap().current.is_none());
        assert!(RUNNER.lock().unwrap().queue.is_empty());
    }

    #[test]
    fn jobs_for_all_is_one_job_per_present_source() {
        let expected: Vec<&str> = SOURCES
            .iter()
            .filter(|def| locate(def.binary).is_some())
            .map(|def| def.id)
            .collect();
        let jobs = jobs_for("all", None).unwrap();
        assert_eq!(
            jobs.iter().map(|j| j.source.as_str()).collect::<Vec<_>>(),
            expected
        );
        assert!(jobs.iter().all(|j| j.item.is_none()));
        let one = jobs_for("brew", None).unwrap();
        assert_eq!(one, vec![job_with("brew", None, "brew upgrade")]);
    }

    fn job_with(source: &str, item: Option<&str>, command: &str) -> UpgradeJob {
        UpgradeJob {
            source: source.into(),
            item: item.map(Into::into),
            command: command.into(),
        }
    }

    #[test]
    fn cancel_drops_the_queue_and_shrinks_the_batch() {
        let _guard = RUNNER_TEST_LOCK.lock().unwrap();
        reset_runner();
        {
            let mut r = RUNNER.lock().unwrap();
            r.enqueue(vec![job("brew", None), job("mas", None), job("mise", None)]);
            assert_eq!(r.batch.total, 3);
        }
        cancel_upgrade();
        let r = RUNNER.lock().unwrap();
        assert!(r.queue.is_empty());
        assert_eq!(r.batch.total, 0);
        drop(r);
        reset_runner();
    }

    #[test]
    fn pump_runs_queued_jobs_in_order_and_remembers_them() {
        let _guard = RUNNER_TEST_LOCK.lock().unwrap();
        reset_runner();
        {
            let mut r = RUNNER.lock().unwrap();
            r.enqueue(vec![
                job_with("brew", Some("one"), "echo one"),
                job_with("brew", Some("two"), "echo two; exit 3"),
            ]);
            pump(&mut r);
            assert!(r.running());
            assert_eq!(r.queue.len(), 1);
        }
        let started = Instant::now();
        loop {
            let r = RUNNER.lock().unwrap();
            if r.recent.len() == 2 && !r.running() {
                assert_eq!(r.recent[0].item.as_deref(), Some("one"));
                assert_eq!(r.recent[0].exit_code, Some(0));
                assert_eq!(r.recent[0].tail, vec!["one"]);
                assert_eq!(r.recent[1].item.as_deref(), Some("two"));
                assert_eq!(r.recent[1].exit_code, Some(3));
                assert_eq!((r.batch.done, r.batch.total, r.batch.failed), (2, 2, 1));
                break;
            }
            drop(r);
            assert!(
                started.elapsed() < Duration::from_secs(10),
                "jobs never finished"
            );
            std::thread::sleep(Duration::from_millis(20));
        }
        reset_runner();
    }

    #[test]
    fn sh_word_quotes_only_what_needs_it() {
        assert_eq!(sh_word("gcc"), "gcc");
        assert_eq!(sh_word("beeper/tap/cli"), "beeper/tap/cli");
        assert_eq!(sh_word("npm:@openai/codex"), "npm:@openai/codex");
        assert_eq!(sh_word("409183694"), "409183694");
        assert_eq!(sh_word("odd name"), "'odd name'");
        assert_eq!(sh_word("it's"), "'it'\\''s'");
        assert_eq!(sh_word(""), "''");
    }

    fn outdated(name: &str, available: &str) -> UpdateItem {
        UpdateItem {
            name: name.into(),
            installed: "1".into(),
            available: available.into(),
            upgrade_command: format!("brew upgrade {name}"),
            ..Default::default()
        }
    }

    #[test]
    fn a_dismissal_hides_a_package_until_it_lapses_or_the_version_moves() {
        let mut map = Dismissals::new();
        map.insert(
            dismissal_key("brew", "cli"),
            Dismissal {
                available: "0.6.3".into(),
                until: 2_000,
            },
        );
        let fresh = || UpdatesReport {
            sources: vec![UpdateSource {
                id: "brew".into(),
                upgrade_command: "brew upgrade".into(),
                items: vec![outdated("cli", "0.6.3"), outdated("gcc", "16.2.0")],
                ..Default::default()
            }],
            ..Default::default()
        };

        // Holding: cli moves out of the count; brew's command becomes gcc's own.
        let mut r = fresh();
        apply_dismissals(&mut r, &map, 1_000);
        let brew = &r.sources[0];
        assert_eq!(brew.items.len(), 1);
        assert_eq!(brew.items[0].name, "gcc");
        assert_eq!(brew.dismissed.len(), 1);
        assert_eq!(brew.dismissed[0].name, "cli");
        assert_eq!(brew.dismissed[0].dismissed_until, 2_000);
        assert_eq!(brew.upgrade_command, "brew upgrade gcc");

        // Lapsed: back as it was.
        let mut r = fresh();
        apply_dismissals(&mut r, &map, 2_000);
        assert_eq!(r.sources[0].items.len(), 2);
        assert!(r.sources[0].dismissed.is_empty());
        assert_eq!(r.sources[0].upgrade_command, "brew upgrade");

        // A newer version than the one dismissed: back early.
        let mut r = fresh();
        r.sources[0].items[0].available = "0.6.4".into();
        apply_dismissals(&mut r, &map, 1_000);
        assert_eq!(r.sources[0].items.len(), 2);

        // Everything dismissed: nothing pending, no command to run.
        map.insert(
            dismissal_key("brew", "gcc"),
            Dismissal {
                available: "16.2.0".into(),
                until: 2_000,
            },
        );
        let mut r = fresh();
        apply_dismissals(&mut r, &map, 1_000);
        assert!(r.sources[0].items.is_empty());
        assert_eq!(r.sources[0].dismissed.len(), 2);
        assert_eq!(r.sources[0].upgrade_command, "");
    }

    #[test]
    fn dismissals_round_trip_through_the_state_file_and_drop_lapsed_entries() {
        let dir = std::env::temp_dir().join(format!(
            "scuttler-dismissals-{}-{}",
            std::process::id(),
            now_secs()
        ));
        let path = dir.join("nested").join("updates-dismissed.json");
        assert_eq!(load_dismissals(&path), Dismissals::new());
        let mut map = Dismissals::new();
        map.insert(
            "brew:cli".into(),
            Dismissal {
                available: "0.6.3".into(),
                until: 5_000,
            },
        );
        map.insert(
            "mas:Xcode".into(),
            Dismissal {
                available: "26.1".into(),
                until: 100,
            },
        );
        save_dismissals(&path, &mut map, 1_000).unwrap();
        assert_eq!(map.len(), 1, "the lapsed entry is pruned on save");
        assert_eq!(load_dismissals(&path), map);
        assert!(!path.with_extension("json.tmp").exists());
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(
            load_dismissals(Path::new("/nonexistent/x.json")),
            Dismissals::new()
        );
    }

    #[test]
    fn last_nonempty_line_skips_trailing_blanks() {
        assert_eq!(
            last_nonempty_line("line one\nline two\n\n"),
            Some("line two".into())
        );
        assert_eq!(last_nonempty_line("\n\n"), None);
        assert_eq!(last_nonempty_line(""), None);
    }

    #[test]
    fn locate_finds_a_system_binary_and_not_nonsense() {
        assert!(locate("ls").is_some());
        assert!(locate("definitely-not-a-real-binary-scuttler").is_none());
    }

    #[test]
    fn upgrade_command_looks_up_a_known_source_regardless_of_presence() {
        assert_eq!(upgrade_command("brew"), Some("brew upgrade".to_string()));
        assert_eq!(upgrade_command("mas"), Some("mas upgrade".to_string()));
        assert_eq!(upgrade_command("mise"), Some("mise upgrade".to_string()));
    }

    #[test]
    fn upgrade_command_unknown_source_is_none() {
        assert_eq!(upgrade_command("definitely-not-a-source"), None);
        assert_eq!(upgrade_command(""), None);
    }

    #[test]
    fn upgrade_command_all_joins_present_sources_in_table_order() {
        // Presence is machine-dependent, so mirror the function's own
        // `locate` filter rather than hardcoding a list of installed tools —
        // this still pins the join separator and the table-order guarantee.
        let expected = SOURCES
            .iter()
            .filter(|def| locate(def.binary).is_some())
            .map(|def| def.upgrade_command)
            .collect::<Vec<_>>()
            .join(" && ");
        assert_eq!(upgrade_command("all"), Some(expected));
    }

    fn row(id: &str, checked_at: u64, error: Option<&str>) -> UpdateSource {
        UpdateSource {
            id: id.into(),
            checked_at,
            error: error.map(Into::into),
            ..Default::default()
        }
    }

    #[test]
    fn a_healthy_row_is_due_once_its_interval_passes() {
        let r = row("brew", 1_000, None);
        assert!(!is_due(&r, SLOW, 1_000 + SLOW.as_secs() - 1));
        assert!(is_due(&r, SLOW, 1_000 + SLOW.as_secs()));
    }

    #[test]
    fn an_errored_row_retries_on_the_short_fuse() {
        let r = row("mas", 1_000, Some("timed out after 60s"));
        assert!(!is_due(&r, SLOW, 1_000 + ERROR_RETRY.as_secs() - 1));
        assert!(is_due(&r, SLOW, 1_000 + ERROR_RETRY.as_secs()));
    }

    #[test]
    fn a_clock_behind_checked_at_is_not_due() {
        assert!(!is_due(&row("brew", 5_000, None), CHEAP, 1_000));
    }

    #[test]
    fn every_interval_is_capped_at_thirty_minutes() {
        assert!(SOURCES.iter().all(|def| def.interval <= SLOW));
        assert!(interval(crate::selfupdate::SOURCE_ID) <= SLOW);
        assert_eq!(interval("nonsense"), Duration::ZERO);
    }

    #[test]
    fn report_is_due_when_never_run_or_any_row_is() {
        assert!(report_due(None, 1_000));
        let fresh = UpdatesReport {
            sources: vec![row("brew", 1_000, None), row("mas", 1_000, None)],
            ..Default::default()
        };
        assert!(!report_due(Some(&fresh), 1_001));
        assert!(report_due(Some(&fresh), 1_000 + CHEAP.as_secs()));
    }

    #[test]
    fn changes_only_counts_rows_whose_result_moved() {
        let mut changed = row("pnpm", 2_000, None);
        changed.items.push(UpdateItem::default());
        let prev = UpdatesReport {
            sources: vec![row("brew", 1_000, None), row("pnpm", 1_000, None)],
            ..Default::default()
        };
        let next = UpdatesReport {
            sources: vec![row("brew", 2_000, None), changed],
            ..Default::default()
        };
        assert_eq!(summary(&next), "refreshed: brew 0 · pnpm 1");
        assert!(moved(Some(&prev), &next));
        assert!(!moved(Some(&next), &next));
        assert!(moved(None, &next));
    }
}
