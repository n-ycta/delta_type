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

The console opens at **http://127.0.0.1:7710**. For the optional local trainer open **http://127.0.0.1:7720** (`?lang=en` or `?lang=ru`). Create a scoped token permitting `call:typing.ingest` in the console and enter it in the trainer. The trainer never sends its text buffer — only aggregate counts and duration. The console's automatic owner login does not automatically grant the separate trainer an owner credential.

## What is measured

- **WPM:** characters / 5 / minutes.
- **Without corrections:** `1 − corrections / characters`. This is not spelling accuracy.
- **Characters entered:** aggregate count.
- **Language:** unknown by default; optionally label the physical keyboard layout as RU or EN. evdev does not report the active compositor layout.
- **Mode:** `background` or `trainer`. New generated widgets filter to background by default; select the `mode` dimension/filter to view trainer data separately.

### Background collection and permissions

Background collection is enabled by default on Linux. It reads keyboard evdev devices, batches aggregate metrics every five seconds and queues them durably for storage; no browser needs to remain open. The collector discovers keyboards via sysfs, rechecks devices every five seconds, and reads only permitted `/dev/input/event*` nodes. It never elevates privileges or changes device permissions. Grant the **service user** keyboard-device access using your distribution's policy, then restart Type. Do not run the web console as root. Access to an `input` group may grant much broader access than just this plugin; prefer narrowly scoped device rules when possible. In containers devices must be explicitly passed through.

`typing.status` reports `running`, `paused`, `unavailable`, `unsupported` or `error`, the reason and bilingual plugin-owned notices. macOS and Windows background capture are **not implemented**. A missing permission/device is not a reason to wait for a dashboard refresh.

Background WPM and character counts are **estimates from physical keys**, not committed text. Modifiers/releases are excluded, repeats count, Backspace/Delete count as corrections. Layout switches, IME, paste, shortcuts and application edits cannot be reconstructed reliably. The optional browser trainer measures its own inputs, rejects IME composition and submits aggregates through `typing.ingest`; older clients without `mode` remain tagged `trainer`.

### Optional sensitive history

`recordKeys` is **off by default**. Enabling it requires `_confirmations: ["type.record-keys.v1"]` in the settings call. The warning and enforcement belong to Type; a web client merely renders the manifest's generic confirmation. Physical key codes, press timestamps and repeat flags may reveal passwords and other private input. Password fields cannot reliably be excluded. **Committed-text recording is not supported**, and key codes are not advertised as text.

History stays in private `keys.ndjson` (0600), never in metric records or the storage plugin. The file is cleared after `retentionDays` (1–30, default 7) from creation or when it exceeds 10 MiB; this intentionally removes the whole history, potentially earlier than the selected lifetime. `typing.clear_history` deletes it manually. No application/window titles are collected. The bounded durable metric outbox retries failures; duplicate session IDs are ignored.

## Use with multiple nodes

Install on a paired device through the hub's plugin dialog, after explicitly allowing administrative trust. To centralize data on the hub, set `STORAGE_NODE` to its node ID in the typing process environment and restart typing. Records use the actual authenticated node identity. This is forwarding aggregate records, not automatic database replication. Both nodes must remain reachable through a VPN or HTTPS proxy.

## Capabilities

`typing.ingest`, `typing.status`, `typing.settings` (admin; omit `values` to read), `typing.flush`, `typing.clear_history` (admin). The supervisor credential only registers `typing` and calls `storage.write`; it does not gain owner access. Producer token name: `dev.delta.type`.

The manifest publishes metrics, dimensions, recommended visualizations, settings and actions, with EN/RU presentation patches. UI language never changes metric IDs or protocol values.

## Develop

```sh
npm ci
npm test
npm start
```

Node 22.12+. Environment: `DELTA_URL`, `DELTA_TOKEN` (supervisor-provided), `DATA_DIR`, `STORAGE_COMPONENT` (default `storage`), optional `STORAGE_NODE`, `PORT` (default `7720`). The trainer binds to loopback. The outbox and collection preferences live in the private data directory. Collection can be paused from the plugin settings.

Licensed under [Apache 2.0](LICENSE).
