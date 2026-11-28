//! Bar data modules beyond the core aerospace/battery/clock set: wifi, ported
//! from the retired Sketchybar plugins. Slow sources refresh on their own
//! threads into statics so they never stall the 1 Hz push loop; `snapshot()`
//! only reads.

use std::process::Command;
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WifiState {
    /// Any connection at all: macOS has a primary interface with a router, or
    /// (with none reported) the Wi-Fi link is up.
    pub online: bool,
    /// What carries traffic: `wifi`, `ethernet`, `tethered`, `other` (a VPN or
    /// bridge), or empty when offline (DECISIONS 2026-11-28).
    pub kind: String,
    /// The primary interface's hardware port as macOS names it ("Wi-Fi",
    /// "Belkin USB-C LAN", "iPhone USB"); None when unknown.
    pub port: Option<String>,
    /// The primary interface (`en8`).
    pub iface: Option<String>,
    /// None while online means macOS withheld the name; the card says "Connected".
    pub ssid: Option<String>,
    /// Signal strength in dBm (corewlan.rs); None when unknown. The bar's
    /// glyph is a strength indicator, the SSID lives in the hover card.
    pub rssi: Option<i32>,
}

static WIFI: Mutex<WifiState> = Mutex::new(WifiState {
    online: false,
    kind: String::new(),
    port: None,
    iface: None,
    ssid: None,
    rssi: None,
});

pub fn wifi() -> WifiState {
    WIFI.lock().unwrap().clone()
}

/// Start the refresh threads. Cadences match the Sketchybar update_freqs.
pub fn start() {
    std::thread::spawn(|| loop {
        // Off means off: no ipconfig/networksetup while the bar is hidden.
        if crate::bar::enabled() {
            refresh_wifi();
        }
        std::thread::sleep(Duration::from_secs(20));
    });
}

pub(crate) fn run(bin: &str, args: &[&str]) -> Option<String> {
    let out = Command::new(bin).args(args).output().ok()?;
    out.status
        .success()
        .then(|| String::from_utf8_lossy(&out.stdout).into_owned())
}

// ---- Wifi ------------------------------------------------------------------
//
// Cheap sources first: `ipconfig getsummary` exposes the SSID without
// Location Services on some macOS builds, `networksetup -getairportnetwork`
// on others. On builds that redact both (Tahoe, 2026-08-17) the only
// unprivileged truth is `system_profiler SPAirPortDataType`, which is a ~15 s
// radio scan — far too heavy for the 20 s poll, so it runs once per *join*:
// getsummary's DHCP lease start / router / security lines change on every
// association, and that key gates the slow resolve. The wifi panel's scan
// uses the same command, so its output tops up the cache for free. Never
// guess from known-network lists: a plausible name is worse than "hidden".
// Online-ness comes from LinkStatusActive.

/// Wi-Fi device name (e.g. "en0"); shared with the wifi panel (wifi.rs).
pub(crate) fn wifi_iface() -> Option<String> {
    run("/usr/sbin/networksetup", &["-listallhardwareports"])
        .as_deref()
        .and_then(parse_wifi_iface)
}

/// What the cheap probes give away in one pass.
#[derive(Debug, Default, PartialEq, Eq)]
struct WifiProbe {
    online: bool,
    ssid: Option<String>,
    /// Fingerprint of the current association (DHCP lease start, router,
    /// security, link); a change means a (re)join happened.
    join_key: String,
}

fn probe_wifi(iface: &str) -> WifiProbe {
    let summary = run("/usr/sbin/ipconfig", &["getsummary", iface]).unwrap_or_default();
    let mut probe = parse_getsummary(&summary);
    if probe.ssid.is_none() {
        probe.ssid = run("/usr/sbin/networksetup", &["-getairportnetwork", iface])
            .as_deref()
            .and_then(parse_airport_network);
    }
    probe
}

/// SSID resolved by the slow path, valid for one `join_key`. `attempts`
/// bounds retries when the scan comes back empty so a genuinely hidden SSID
/// doesn't cost a radio scan every poll.
#[derive(Debug, Default)]
struct Resolved {
    join_key: String,
    ssid: Option<String>,
    attempts: u8,
}

const RESOLVE_ATTEMPTS: u8 = 3;

static RESOLVED: Mutex<Resolved> = Mutex::new(Resolved {
    join_key: String::new(),
    ssid: None,
    attempts: 0,
});

/// Cached slow-path SSID for this association, if any.
fn resolved_for(join_key: &str) -> Option<String> {
    let r = RESOLVED.lock().unwrap();
    (r.join_key == join_key).then(|| r.ssid.clone()).flatten()
}

/// Whether the slow path should run for this association: never resolved,
/// or resolved empty fewer than RESOLVE_ATTEMPTS times.
fn needs_resolve(join_key: &str) -> bool {
    let r = RESOLVED.lock().unwrap();
    r.join_key != join_key || (r.ssid.is_none() && r.attempts < RESOLVE_ATTEMPTS)
}

fn record_resolved(join_key: &str, ssid: Option<String>) {
    let mut r = RESOLVED.lock().unwrap();
    if r.join_key != join_key {
        r.attempts = 0;
    }
    r.join_key = join_key.to_owned();
    r.attempts = r.attempts.saturating_add(1);
    r.ssid = ssid;
}

/// Non-blocking read: cheap probes plus whatever the slow path already
/// resolved for this association. Safe from Tauri commands.
pub(crate) fn read_wifi() -> WifiState {
    let ports = hardware_ports();
    if let Some(state) = wired_state(&ports) {
        return state;
    }
    let Some(iface) = wifi_iface_in(&ports) else {
        return WifiState::default();
    };
    let probe = probe_wifi(&iface);
    let ssid = probe.ssid.or_else(|| {
        probe
            .online
            .then(|| resolved_for(&probe.join_key))
            .flatten()
    });
    WifiState {
        rssi: probe.online.then(crate::corewlan::rssi).flatten(),
        ssid,
        ..wifi_link(probe.online, &iface)
    }
}

// ---- Network ---------------------------------------------------------------
//
// "Online" used to mean "the Wi-Fi link is up", so a Mac on Ethernet read as
// Offline (Mitch, 2026-11-28). macOS names the interface that carries traffic
// in `State:/Network/Global/IPv4` (`PrimaryInterface`, `Router`); its hardware
// port says what kind of link it is. Both are cheap reads.

/// `networksetup -listallhardwareports`, once per refresh.
fn hardware_ports() -> String {
    run("/usr/sbin/networksetup", &["-listallhardwareports"]).unwrap_or_default()
}

/// (port, device) pairs from `networksetup -listallhardwareports`.
fn parse_ports(out: &str) -> Vec<(String, String)> {
    let mut ports = Vec::new();
    let mut port: Option<String> = None;
    for line in out.lines() {
        if let Some(p) = line.strip_prefix("Hardware Port: ") {
            port = Some(p.trim().to_owned());
        } else if let (Some(d), Some(p)) = (line.strip_prefix("Device: "), port.take()) {
            ports.push((p, d.trim().to_owned()));
        }
    }
    ports
}

/// The primary interface and its router from `scutil` (`show
/// State:/Network/Global/IPv4`); None when macOS reports no primary.
fn parse_primary(out: &str) -> Option<(String, Option<String>)> {
    let field = |name: &str| {
        out.lines()
            .find_map(|l| l.trim().strip_prefix(name)?.trim().strip_prefix(": "))
            .map(|v| v.trim().to_owned())
            .filter(|v| !v.is_empty())
    };
    Some((field("PrimaryInterface")?, field("Router")))
}

/// What kind of link a port is. VPN tunnels and bridges are `other`; a phone
/// over USB is `tethered`; any other named port with a device is `ethernet`.
fn link_kind(port: Option<&str>, device: &str) -> &'static str {
    let port = port.unwrap_or("");
    if port == "Wi-Fi" || port.contains("AirPort") {
        "wifi"
    } else if ["utun", "ipsec", "ppp", "tun", "tap"]
        .iter()
        .any(|p| device.starts_with(p))
        || port.contains("Bridge")
    {
        "other"
    } else if ["iPhone", "iPad", "Android"]
        .iter()
        .any(|p| port.contains(p))
    {
        "tethered"
    } else if port.is_empty() {
        "other"
    } else {
        "ethernet"
    }
}

/// The state for a primary interface that isn't Wi-Fi; None when the primary
/// is Wi-Fi or there is none (the Wi-Fi probe decides then).
fn wired_state(ports_out: &str) -> Option<WifiState> {
    let out = Command::new("/usr/sbin/scutil")
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .spawn()
        .ok()
        .and_then(|mut child| {
            use std::io::Write;
            child
                .stdin
                .take()?
                .write_all(b"show State:/Network/Global/IPv4\n")
                .ok()?;
            child.wait_with_output().ok()
        })?;
    wired_from(&String::from_utf8_lossy(&out.stdout), ports_out)
}

/// `wired_state` without the process: pure over the two outputs.
fn wired_from(scutil_out: &str, ports_out: &str) -> Option<WifiState> {
    let (iface, router) = parse_primary(scutil_out)?;
    let ports = parse_ports(ports_out);
    let port = ports
        .iter()
        .find(|(_, d)| *d == iface)
        .map(|(p, _)| p.clone());
    let kind = link_kind(port.as_deref(), &iface);
    if kind == "wifi" {
        return None;
    }
    Some(WifiState {
        online: router.is_some() || kind == "other",
        kind: kind.to_owned(),
        port,
        iface: Some(iface),
        ssid: None,
        rssi: None,
    })
}

/// The Wi-Fi interface named in an already-read port list.
fn wifi_iface_in(ports_out: &str) -> Option<String> {
    parse_wifi_iface(ports_out)
}

/// A Wi-Fi state's link fields.
fn wifi_link(online: bool, iface: &str) -> WifiState {
    WifiState {
        online,
        kind: if online { "wifi".into() } else { String::new() },
        port: Some("Wi-Fi".into()),
        iface: Some(iface.to_owned()),
        ssid: None,
        rssi: None,
    }
}

/// One poller tick: publish the cheap state, then — only when the SSID is
/// redacted for a not-yet-resolved association — block on the ~15 s scan and
/// publish again. Runs on the wifi refresh thread only.
fn refresh_wifi() {
    let ports = hardware_ports();
    // Ethernet, a tethered phone or a VPN carries traffic: say so, and skip
    // the Wi-Fi probes entirely.
    if let Some(state) = wired_state(&ports) {
        *WIFI.lock().unwrap() = state;
        return;
    }
    let Some(iface) = wifi_iface_in(&ports) else {
        *WIFI.lock().unwrap() = WifiState::default();
        return;
    };
    let probe = probe_wifi(&iface);
    let rssi = probe.online.then(crate::corewlan::rssi).flatten();
    let cheap = WifiState {
        ssid: probe.ssid.clone().or_else(|| resolved_for(&probe.join_key)),
        rssi,
        ..wifi_link(probe.online, &iface)
    };
    *WIFI.lock().unwrap() = cheap.clone();
    if cheap.ssid.is_some() || !probe.online || !needs_resolve(&probe.join_key) {
        return;
    }
    let ssid = run("/usr/sbin/system_profiler", &["SPAirPortDataType", "-json"])
        .as_deref()
        .and_then(parse_current_network);
    record_resolved(&probe.join_key, ssid.clone());
    // The association may have changed during the scan; only publish if the
    // fingerprint still matches, otherwise the next tick sorts it out.
    if probe_wifi(&iface).join_key == probe.join_key {
        *WIFI.lock().unwrap() = WifiState {
            ssid,
            rssi,
            ..wifi_link(probe.online, &iface)
        };
    }
}

/// The wifi panel's scan is the same `system_profiler` call: harvest the
/// current network name from it so the bar learns the SSID without a second
/// scan.
pub(crate) fn note_scan_output(json: &str) {
    let Some(ssid) = parse_current_network(json) else {
        return;
    };
    let Some(iface) = wifi_iface() else {
        return;
    };
    let probe = probe_wifi(&iface);
    record_resolved(&probe.join_key, Some(ssid.clone()));
    let mut state = WIFI.lock().unwrap();
    // Only while Wi-Fi is the link in use: a scan on an Ethernet Mac must not
    // turn the cell back into Wi-Fi.
    if probe.online && probe.ssid.is_none() && matches!(state.kind.as_str(), "wifi" | "") {
        *state = WifiState {
            ssid: Some(ssid),
            rssi: crate::corewlan::rssi(),
            ..wifi_link(true, &iface)
        };
    }
}

/// `spairport_current_network_information._name` from SPAirPort JSON — the
/// one field macOS doesn't redact without Location Services.
pub(crate) fn parse_current_network(json: &str) -> Option<String> {
    let root: serde_json::Value = serde_json::from_str(json).ok()?;
    root.get("SPAirPortDataType")?
        .get(0)?
        .get("spairport_airport_interfaces")?
        .as_array()?
        .iter()
        .find_map(|iface| {
            iface
                .get("spairport_current_network_information")?
                .get("_name")?
                .as_str()
                .filter(|s| valid_ssid(s))
                .map(str::to_owned)
        })
}

/// Device name on the line after the Wi-Fi/AirPort hardware port.
fn parse_wifi_iface(out: &str) -> Option<String> {
    let mut lines = out.lines();
    while let Some(line) = lines.next() {
        if line.contains("Wi-Fi") || line.contains("AirPort") {
            return lines
                .next()?
                .strip_prefix("Device: ")
                .map(|d| d.trim().to_owned());
        }
    }
    None
}

/// Lines of `ipconfig getsummary` that fingerprint an association.
const JOIN_KEY_FIELDS: [&str; 4] = [
    "LinkStatusActive : ",
    "LeaseStartTime : ",
    "Router : ",
    "Security : ",
];

/// SSID (redacted → None), link-active, and join fingerprint from
/// `ipconfig getsummary`.
fn parse_getsummary(out: &str) -> WifiProbe {
    let mut probe = WifiProbe::default();
    let mut key = Vec::new();
    for line in out.lines() {
        let line = line.trim();
        if let Some(v) = line.strip_prefix("SSID : ") {
            if valid_ssid(v) {
                probe.ssid = Some(v.to_owned());
            }
        } else if let Some(v) = line.strip_prefix("LinkStatusActive : ") {
            probe.online = v.trim() == "TRUE";
        }
        if JOIN_KEY_FIELDS.iter().any(|f| line.starts_with(f)) {
            key.push(line.to_owned());
        }
    }
    probe.join_key = key.join("|");
    probe
}

fn parse_airport_network(out: &str) -> Option<String> {
    let v = out.trim().strip_prefix("Current Wi-Fi Network: ")?;
    valid_ssid(v).then(|| v.to_owned())
}

fn valid_ssid(s: &str) -> bool {
    !s.is_empty() && s != "<redacted>" && !s.starts_with("You are not associated")
}

#[cfg(test)]
mod tests {
    use super::*;

    const PORTS: &str = "\
Hardware Port: Ethernet Adapter (en3)
Device: en3
Ethernet Address: e2:37:f5:37:c4:fe

Hardware Port: Belkin USB-C LAN
Device: en8
Ethernet Address: d8:ec:5e:74:d3:31

Hardware Port: Thunderbolt Bridge
Device: bridge0
Ethernet Address: 02:00:00:00:00:00

Hardware Port: Wi-Fi
Device: en0
Ethernet Address: fc:b2:14:e4:be:3a

Hardware Port: iPhone USB
Device: en9
Ethernet Address: 36:ee:16:7e:a4:b8
";

    fn primary(iface: &str, router: Option<&str>) -> String {
        let router = router.map_or(String::new(), |r| format!("  Router : {r}\n"));
        format!(
            "<dictionary> {{\n  PrimaryInterface : {iface}\n  PrimaryService : 9EBA\n{router}}}\n"
        )
    }

    #[test]
    fn ethernet_is_online_not_offline() {
        let s = wired_from(&primary("en8", Some("192.168.2.1")), PORTS).unwrap();
        assert!(s.online);
        assert_eq!(s.kind, "ethernet");
        assert_eq!(s.port.as_deref(), Some("Belkin USB-C LAN"));
        assert_eq!(s.iface.as_deref(), Some("en8"));
        assert_eq!((s.ssid, s.rssi), (None, None));
    }

    #[test]
    fn wifi_primary_is_left_to_the_wifi_probe() {
        assert_eq!(wired_from(&primary("en0", Some("10.0.0.1")), PORTS), None);
        assert_eq!(wired_from("<dictionary> {\n}\n", PORTS), None, "no primary");
        assert_eq!(wired_from("", PORTS), None);
    }

    #[test]
    fn tethered_vpn_and_unknown_ports_are_named() {
        let t = wired_from(&primary("en9", Some("172.20.10.1")), PORTS).unwrap();
        assert_eq!((t.kind.as_str(), t.online), ("tethered", true));
        let v = wired_from(&primary("utun4", None), PORTS).unwrap();
        assert_eq!((v.kind.as_str(), v.online, v.port), ("other", true, None));
        let b = wired_from(&primary("bridge0", Some("x")), PORTS).unwrap();
        assert_eq!(b.kind, "other");
        let gone = wired_from(&primary("en3", None), PORTS).unwrap();
        assert_eq!(
            (gone.kind.as_str(), gone.online),
            ("ethernet", false),
            "no router, no route"
        );
    }

    #[test]
    fn ports_parse_in_order() {
        let ports = parse_ports(PORTS);
        assert_eq!(ports.len(), 5);
        assert_eq!(ports[1], ("Belkin USB-C LAN".to_owned(), "en8".to_owned()));
        assert_eq!(parse_wifi_iface(PORTS).as_deref(), Some("en0"));
    }

    #[test]
    fn finds_wifi_iface() {
        let out = "Hardware Port: Thunderbolt Bridge\nDevice: bridge0\n\nHardware Port: Wi-Fi\nDevice: en0\nEthernet Address: aa:bb\n";
        assert_eq!(parse_wifi_iface(out), Some("en0".into()));
        assert_eq!(
            parse_wifi_iface("Hardware Port: Ethernet\nDevice: en5\n"),
            None
        );
    }

    #[test]
    fn parses_getsummary_states() {
        let redacted = "  LinkStatusActive : TRUE\n  SSID : <redacted>\n";
        let p = parse_getsummary(redacted);
        assert_eq!((p.ssid, p.online), (None, true));
        let clear = "  SSID : Cinque\n  LinkStatusActive : TRUE\n";
        let p = parse_getsummary(clear);
        assert_eq!((p.ssid, p.online), (Some("Cinque".into()), true));
        assert_eq!(parse_getsummary(""), WifiProbe::default());
    }

    #[test]
    fn join_key_tracks_association_not_ssid() {
        let a = "  BSSID : <redacted>\n      LeaseStartTime : 08/17/2026 08:18:12\n      Router : 192.168.1.1\n  LinkStatusActive : TRUE\n  SSID : <redacted>\n  Security : WPA2_PSK\n";
        let b = a.replace("08:18:12", "09:00:00");
        let same_but_redacted_differently = a.replace("<redacted>", "<hidden>");
        assert_ne!(parse_getsummary(a).join_key, parse_getsummary(&b).join_key);
        assert_eq!(
            parse_getsummary(a).join_key,
            parse_getsummary(&same_but_redacted_differently).join_key
        );
        assert!(!parse_getsummary(a).join_key.contains("SSID"));
    }

    #[test]
    fn parses_airport_network() {
        assert_eq!(
            parse_airport_network("Current Wi-Fi Network: RamenAmok\n"),
            Some("RamenAmok".into())
        );
        assert_eq!(
            parse_airport_network("You are not associated with an AirPort network.\n"),
            None
        );
    }

    #[test]
    fn parses_current_network_from_system_profiler() {
        let json = r#"{"SPAirPortDataType":[{"spairport_airport_interfaces":[
            {"_name":"en0","spairport_current_network_information":{"_name":"RamenAmok-2.4","spairport_network_channel":"1 (2GHz, 20MHz)"}},
            {"_name":"awdl0","spairport_current_network_information":{"spairport_network_type":"spairport_network_type_station"}}
        ]}]}"#;
        assert_eq!(parse_current_network(json), Some("RamenAmok-2.4".into()));
        let off = r#"{"SPAirPortDataType":[{"spairport_airport_interfaces":[{"_name":"en0"}]}]}"#;
        assert_eq!(parse_current_network(off), None);
        assert_eq!(parse_current_network("not json"), None);
    }

    #[test]
    fn resolve_cache_is_per_join_and_bounded() {
        record_resolved("k1", None);
        assert!(needs_resolve("k1"));
        record_resolved("k1", None);
        record_resolved("k1", None);
        assert!(!needs_resolve("k1"), "gives up after RESOLVE_ATTEMPTS");
        assert!(needs_resolve("k2"), "new association resolves again");
        record_resolved("k2", Some("Cinque".into()));
        assert_eq!(resolved_for("k2"), Some("Cinque".into()));
        assert_eq!(resolved_for("k1"), None);
        assert!(!needs_resolve("k2"));
    }

    #[test]
    #[ignore = "runs the ~15 s system_profiler scan against this Mac; run by hand to check the resolved SSID"]
    fn live_wifi_resolve() {
        let iface = wifi_iface().expect("wifi iface");
        let probe = probe_wifi(&iface);
        println!("probe: {probe:#?}");
        refresh_wifi();
        println!("published: {:#?}", wifi());
        if probe.online {
            assert!(wifi().ssid.is_some(), "online but SSID unresolved");
        }
    }
}
