# Delta Type

**Understand your typing, without recording what you type.** Opt-in Russian/English aggregate statistics for Delta dashboards.

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
- **Language:** chosen explicitly as RU or EN, not inferred from private text.

No keylogger, background global keyboard hook, application title or password capture. IME composition is rejected by the trainer instead of reporting unreliable counts. Trusted aggregate clients can call `typing.ingest` directly with a typed session. A bounded, durable outbox retries storage failures without losing accepted sessions; duplicate session IDs are ignored.

## Use with multiple nodes

Install on a paired device through the hub's plugin dialog, after explicitly allowing administrative trust. To centralize data on the hub, set `STORAGE_NODE` to its node ID in the typing process environment and restart typing. Records use the actual authenticated node identity. This is forwarding aggregate records, not automatic database replication. Both nodes must remain reachable through a VPN or HTTPS proxy.

## Capabilities

`typing.ingest`, `typing.status`, `typing.settings` (admin), `typing.flush`. The supervisor credential only registers `typing` and calls `storage.write`; it does not gain owner access. Producer token name: `dev.delta.type`.

The manifest publishes metrics, dimensions, recommended visualizations, settings and actions, with EN/RU presentation patches. UI language never changes metric IDs or protocol values.

## Develop

```sh
npm ci
npm test
npm start
```

Node 22.12+. Environment: `DELTA_URL`, `DELTA_TOKEN` (supervisor-provided), `DATA_DIR`, `STORAGE_COMPONENT` (default `storage`), optional `STORAGE_NODE`, `PORT` (default `7720`). The trainer binds to loopback. The outbox and collection preferences live in the private data directory. Collection can be paused from the plugin settings.

Licensed under [Apache 2.0](LICENSE).
