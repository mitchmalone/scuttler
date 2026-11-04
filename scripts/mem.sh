#!/usr/bin/env bash
# Resident memory of the running scuttler and everything it spawned — the number
# the definition of done asks for (AGENTS.md, DECISIONS 2026-11-01 "the receipt").
#
#   scripts/mem.sh            one raw reading: the app and each helper, plus the total
#   scripts/mem.sh --watch    a raw reading every 5 s (Ctrl-C to stop)
#   scripts/mem.sh --receipt  the budget number: three readings 10 s apart, the median
#                             total, and a warning when the running config is not the
#                             reference one (agents monitor on, plugin services up)
#   scripts/mem.sh --webkit   the floor the receipt does not count: every process macOS
#                             holds scuttler responsible for (WebKit's WebContent, GPU and
#                             Networking helpers, borders, plugin services) with each one's
#                             physical footprint, plus the app's own footprint and how much
#                             of it is memory the app owns but no longer maps — the number
#                             that grew to 3.6 GB in 20 h on 2026-11-05 (JOURNAL)
#
# The budget is idle resident < 120 MB, panel hidden, under the reference config: a
# release build, bar on, agents monitor off, no plugin services, one display, read a
# minute after launch. Helpers (plugin services, Bun, the setup CLI) count when they
# are running: they're ours. Reads `ps`, needs nothing.
set -euo pipefail

root_pid() { pgrep -x scuttler | head -1 || true; }

# Every descendant of the app: plugin services and their helpers.
descendants() {
  local root=$1
  for c in $(pgrep -P "$root" || true); do
    echo "$c"
    for g in $(pgrep -P "$c" || true); do echo "$g"; done
  done
}

# Total RSS in KB of the app and its descendants; helper count on stderr-free channel.
total_kb() {
  local root=$1 total=0 rss
  for pid in "$root" $(descendants "$root"); do
    rss=$(ps -o rss= -p "$pid" 2>/dev/null | tr -d ' ' || echo 0)
    [[ -n "$rss" ]] || continue
    total=$((total + rss))
  done
  echo "$total"
}

mb() { echo "$1 / 1024" | bc -l; }

reading() {
  local root
  root=$(root_pid)
  if [[ -z "$root" ]]; then
    echo "scuttler is not running"
    return 1
  fi
  local total=0 rss cmd
  printf '%-8s %8s  %s\n' PID 'RSS MB' COMMAND
  for pid in "$root" $(descendants "$root"); do
    rss=$(ps -o rss= -p "$pid" 2>/dev/null | tr -d ' ' || echo 0)
    [[ -n "$rss" ]] || continue
    cmd=$(ps -o comm= -p "$pid" 2>/dev/null | sed 's|.*/||')
    printf '%-8s %8.1f  %s\n' "$pid" "$(mb "$rss")" "$cmd"
    total=$((total + rss))
  done
  printf '%-8s %8.1f  %s\n' total "$(mb "$total")" "(budget: idle < 120 MB, panel hidden, reference config)"
}

receipt() {
  local root
  root=$(root_pid)
  if [[ -z "$root" ]]; then
    echo "scuttler is not running"
    return 1
  fi
  local helpers config
  helpers=$(descendants "$root" | wc -l | tr -d ' ')
  config=$HOME/.config/scuttler/config.json
  local monitor="unknown"
  if [[ -f "$config" ]]; then
    # The reference config has agents.monitor off; a plain-text probe is enough here.
    if tr -d ' \n' <"$config" | grep -q '"monitor":true'; then monitor=on; else monitor=off; fi
  fi
  local etime
  etime=$(ps -o etime= -p "$root" | tr -d ' ')
  local r1 r2 r3
  r1=$(total_kb "$root"); sleep 10
  r2=$(total_kb "$root"); sleep 10
  r3=$(total_kb "$root")
  local median
  median=$(printf '%s\n%s\n%s\n' "$r1" "$r2" "$r3" | sort -n | sed -n 2p)
  printf 'readings  %.1f  %.1f  %.1f MB\n' "$(mb "$r1")" "$(mb "$r2")" "$(mb "$r3")"
  printf 'receipt   %.1f MB  (median; budget < 120 MB; app up %s)\n' "$(mb "$median")" "$etime"
  local warn=0
  if [[ "$helpers" != "0" ]]; then
    echo "warning   $helpers helper process(es) running — the reference config has no plugin services"
    warn=1
  fi
  if [[ "$monitor" == "on" ]]; then
    echo "warning   agents.monitor is on — the reference config has it off"
    warn=1
  fi
  if [[ "$warn" == 1 ]]; then
    echo "          this is a daily-footprint reading, not the receipt"
  fi
}

# Everything macOS attributes to the app, launchd children included. WebKit's
# helpers are XPC services whose parent is launchd, so `pgrep -P` never sees
# them; the kernel's "responsible pid" (what Activity Monitor groups by) does.
# That call lives in libquarantine and has no CLI, hence python's ctypes.
webkit() {
  local root
  root=$(root_pid)
  if [[ -z "$root" ]]; then
    echo "scuttler is not running"
    return 1
  fi
  echo "responsible for (physical footprint, MB):"
  python3 -I - "$root" <<'PY'
import ctypes, subprocess, sys
root = int(sys.argv[1])
lib = ctypes.CDLL('/usr/lib/system/libquarantine.dylib')
f = lib.responsibility_get_pid_responsible_for_pid
f.restype, f.argtypes = ctypes.c_int, [ctypes.c_int]
def footprint(pid):
    try:
        out = subprocess.run(['footprint', str(pid)], capture_output=True, text=True, timeout=20).stdout
    except Exception:
        return None, None
    phys = unmapped = None
    for line in out.splitlines():
        if 'phys_footprint:' in line:
            phys = to_mb(line.split()[1], line.split()[2])
        if line.rstrip().endswith('Owned physical footprint (unmapped)'):
            unmapped = to_mb(line.split()[0], line.split()[1])
    return phys, unmapped
def to_mb(value, unit):
    scale = {'B': 1 / 1048576, 'KB': 1 / 1024, 'MB': 1, 'GB': 1024}.get(unit, 1)
    try:
        return float(value) * scale
    except ValueError:
        return None
rows = []
for line in subprocess.check_output(['ps', '-axo', 'pid=,comm=']).decode().splitlines():
    pid, comm = line.split(None, 1)
    pid = int(pid)
    if pid != root and f(pid) == root:
        rows.append((pid, comm.rsplit('/', 1)[-1]))
total = 0
for pid, comm in rows:
    phys, _ = footprint(pid)
    total += phys or 0
    print(f'  {pid:<8}{(phys or 0):>8.1f}  {comm}')
phys, unmapped = footprint(root)
print(f'  helpers {total:>8.1f}  total')
print(f'app      {(phys or 0):>8.1f}  physical footprint, of which owned but unmapped: {(unmapped or 0):.1f} MB')
PY
}

case "${1:-}" in
  --watch)
    while true; do
      clear
      date '+%H:%M:%S'
      reading || true
      sleep 5
    done
    ;;
  --receipt) receipt ;;
  --webkit) webkit ;;
  "") reading ;;
  *) echo "usage: scripts/mem.sh [--watch | --receipt | --webkit]" >&2; exit 2 ;;
esac
