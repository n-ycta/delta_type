# Delta Type

**Background typing statistics for Linux, with an optional separate trainer.** Aggregate metrics by default; optional local physical-key history requires explicit acknowledgement.

![Typing dashboard with generated QA aggregate sessions](https://raw.githubusercontent.com/n-ycta/delta/main/docs/images/metrics.png)

## Install

Installs the node (if absent), storage, web console and typing plugin from prebuilt releases. No Rust build required.

```sh
curl -fsSL https://raw.githubusercontent.com/n-ycta/delta_type/main/install.sh -o delta-type-install.sh
sh delta-type-install.sh
```

```powershell
Invoke-WebRequest https://raw.githubusercontent.com/n-ycta/delta_type/main/install.ps1 -OutFile delta-type-install.ps1
.\delta-type-install.ps1
```

The console opens at **http://127.0.0.1:7710**. For the optional local trainer open **http://127.0.0.1:7720** (`?lang=en` or `?lang=ru`). Create a scoped token permitting `call:typing.ingest` in the console and enter it in the trainer. The trainer never sends its text buffer — aggregate counts/duration plus optional explicitly consented word counts. The console's automatic owner login does not automatically grant the separate trainer an owner credential.

## What is measured

- **WPM:** eligible character intervals / 5 / active minutes; idle threshold is configurable.
- **Without corrections:** `1 − corrections / characters`. This is not spelling accuracy.
- **Characters entered:** aggregate count.
- **Language:** automatic OS/compositor layout via native adapters, arbitrary BCP-47 identifiers; unknown if the active desktop is unsupported.
- **Mode:** `background` or `trainer`. New generated widgets filter to background by default; select the `mode` dimension/filter to view trainer data separately.

### Background collection and permissions

Background collection is enabled by default on supported Linux and Windows desktops. It reads keyboard evdev devices, batches aggregate metrics every five seconds and queues them durably for storage; no browser needs to remain open. The collector discovers keyboards via sysfs, rechecks devices every five seconds, and reads only permitted `/dev/input/event*` nodes. The collector never elevates privileges. If access is denied, click **Allow keyboard access** in Type's notice (plugin page or dashboard), read the Type-owned warning, then approve the **OS polkit dialog on the node**. The browser itself cannot authorize OS access. The Linux node needs `polkit` (`pkexec`), Python 3 and `acl` (`getfacl`/`setfacl`), with a graphical polkit agent in the signed-in desktop session. A missing dependency, cancelled prompt, timeout or unavailable agent appears in Type status.

The explicitly authorized helper grants only the requesting service user's read access to **currently attached keyboard** event devices. It does not change the `input` group, run the web service as root, grant write access, loosen other users' ACL mask, or install a persistent root service. The grant lasts until the keyboard reconnects or the machine reboots; click again afterwards. **Revoke granted keyboard access** undoes Type's ACL additions after OS approval, restoring prior entries and leaving changed permissions or replaced devices untouched. Disable background collection to close input descriptors immediately. In containers devices must still be explicitly passed through. On remote/headless nodes, a web browser is not a substitute for a local OS authorization agent; administrative device policy may be necessary.

`typing.status` reports `running`, `paused`, `unavailable`, `unsupported` or `error`, the reason and bilingual plugin-owned notices. macOS background capture is **not implemented**; Windows requires an interactive user desktop. A missing permission/device is not a reason to wait for a dashboard refresh.

Background WPM and character counts are **estimates from physical keys**, not committed text. Modifiers/releases are excluded, repeats count, Backspace/Delete count as corrections. Layout switches, IME, paste, shortcuts and application edits cannot be reconstructed reliably. The optional browser trainer measures its own inputs, counts committed composition in its own field and submits aggregates through `typing.ingest`; older clients without `mode` remain tagged `trainer`.

### Optional sensitive history

`recordKeys` is **off by default**. Enabling it requires `_confirmations: ["type.record-keys.v1"]` in the settings call. The warning and enforcement belong to Type; a web client merely renders the manifest's generic confirmation. Physical key codes, press timestamps and repeat flags may reveal passwords and other private input. Password fields cannot reliably be excluded. **Committed-text recording is not supported**, and key codes are not advertised as text.

History stays in private `keys.ndjson` (0600), never in metric records or the storage plugin. The file is cleared after `retentionDays` (1–30, default 7) from creation or when it exceeds 10 MiB; this intentionally removes the whole history, potentially earlier than the selected lifetime. `typing.clear_history` deletes it manually. No application/window titles are collected. The bounded durable metric outbox retries failures; duplicate session IDs are ignored.

## Use with multiple nodes

Install on a paired device through the hub's plugin dialog, after explicitly allowing administrative trust. To centralize data on the hub, set `STORAGE_NODE` to its node ID in the typing process environment and restart typing. Records use the actual authenticated node identity. This is forwarding aggregate records, not automatic database replication. Both nodes must remain reachable through a VPN or HTTPS proxy.

## Capabilities

`typing.ingest`, `typing.status`, `typing.settings` (admin; omit `values` to read), `typing.flush`, `typing.clear_history` (admin), `typing.request_input_access` and `typing.revoke_input_access` (admin, Linux OS authorization required). The supervisor credential registers `typing` and calls compatible `*.health/write/query/aggregate/delete` endpoints for selected storage; it does not gain owner access. Producer token name: `dev.delta.type`.

The manifest publishes metrics, dimensions, recommended visualizations, settings and actions, with EN/RU presentation patches. UI language never changes metric IDs or protocol values.

## Develop

```sh
npm ci
npm test
npm start
```

Node 22.12+. Environment: `DELTA_URL`, `DELTA_TOKEN` (supervisor-provided), `DATA_DIR`, `STORAGE_COMPONENT` (default `storage`), optional `STORAGE_NODE`, `PORT` (default `7720`). The trainer binds to loopback. The outbox and collection preferences live in the private data directory. Collection can be paused from the plugin settings.

Licensed under [Apache 2.0](LICENSE).

## 0.4: background analytics and optional words

Type owns schemas `dev.delta.type.session.v2` and `dev.delta.type.word.v1`. Settings select `storageComponent` (default `storage`) and optional `storageNode`; compatible providers need contract 1.1 aggregate/delete capabilities. Switching validates the candidate and drains the old outbox; existing history is not migrated. The durable outbox retries unavailable storage. File storage is limited to 100,000 records: use PostgreSQL for continuous collection.

**Words are off by default and require Type-owned acknowledgement `type.record-words.v1`**. This is independent of raw key history consent. Dictionaries can contain passwords/private words. No full document is sent, but a dictionary is still sensitive. Metrics query is admin-only; the generic Web bridge preserves caller permissions. Enable words in Plugins → Delta Type → Settings, then open the generated Type dashboard or add a word-frequency widget. Bubbles encode count by **area**, top-N (1–50) is adjustable; table, bars and donut are alternatives. Group `word` combines layouts, `word_language` separates them; filter `language` accepts arbitrary BCP-47 identifiers. `excludedWords` prevents new collection and hides existing matches; `flaggedWords` marks filler words without excluding them. Clear words is a separate Type action; numeric statistics survive. Retention defaults to 30 days for word records.

WPM = eligible character intervals × 12,000 / active milliseconds (standard five-character word). A first key has no preceding measurable interval and does not invent speed. Gaps above `idleThresholdMs` (default 2,000 ms) and trailing silence are excluded when `excludeIdle` is on. Ratios are weighted by their actual denominator, not averages of bucket averages. Additional metrics: active seconds, corrections, correction rate (not spelling accuracy), bursts, pauses and longest burst. Background and trainer use separate mode dimensions.

### Native input support and honest limits

- Linux evdev provides physical events. Automatic layout/text reconstruction uses unprivileged Python 3, libxkbcommon and xkeyboard-config metadata; adapters: Hyprland (including Omarchy), Sway (`swaymsg`) and X11. Active layout and keyboard identity come from OS/compositor, not language guessing; no fixed RU/EN set. Multiple ambiguous sessions/keyboards fail visibly rather than choosing one.
- Linux permissions remain an explicit Type action and native polkit authorization on the target desktop; Web never runs as root. Required packages for Arch/Omarchy: `python libxkbcommon xkeyboard-config polkit acl` plus an active polkit authentication agent.
- Windows uses a current-user interactive desktop keyboard hook and foreground thread layout, not a root/admin web service. PowerShell execution policy is honored; Session 0/secure desktops/elevated applications may not be capturable. Windows CI compiles the native helper and tests layout IDs; actual hardware capture must be checked on a Windows desktop.
- These are **reconstructed typed tokens**, not final document text. Delimiters commit words; incomplete words, cursor edits, paste and arbitrary IMEs cannot be faithfully recovered from global physical input. Detected IBus/Fcitx non-keyboard engines and Windows IMEs suppress word reconstruction; unknown custom input methods remain a limitation. Unsupported Wayland desktops keep physical counters with unknown language and an explicit adapter notice. Manual language only labels physical metrics; it does not pretend to decode text.
- Trainer is optional, explicitly separate, supports arbitrary BCP-47 language and optional word dictionaries, and rejects paste for timing. No automatic browser OS-layout claim.

Tests use real libxkbcommon with fixture compositor IPC (German/Russian/French), not an actual Omarchy desktop or hardware. PostgreSQL/file/alternate storage and UI integration are tested separately.
