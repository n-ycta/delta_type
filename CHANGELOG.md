# Changelog

## Release policy

- Collect compatible fixes in **Unreleased**; do not publish a separate release for every small commit.
- Publish tested, meaningful batches only after explicit maintainer approval.
- Before tagging, move the reviewed changes into a version section below. Release workflows require that section.
- Historical patch releases have been consolidated into the next retained release. Git tags remain available for source history and comparison links.

## [Unreleased]

- No pending changes.

## [v0.4.5]

- Restore effective, root-owned persistent keyboard consent on plugin restart.
- Do not open another polkit prompt when that policy and keyboard read access already exist.
- Reject untrusted rules and ineffective permissions; keep explicit OS approval for the first grant or repairs.
- Correct notices to explain revocable access across reboot and reconnect.
- Add persistent-policy/restart regression tests; physical desktop validation remains required.

## [v0.4.4]

### Fixes
- Preserve explicitly granted Linux keyboard access across reboot and keyboard reconnect instead of granting access only to temporary device nodes.
- Reapply read-only access to keyboard devices for the approved service user without repeated polkit prompts.
- Remove persistent consent and udev rules before restoring ACLs, so queued device events cannot regrant revoked access.

### Security
- Keep the grant keyboard-only and UID-bound; never add the user to the input group, grant device write access, or widen ACL masks.
- Use a root-owned udev event helper, not a root daemon; keep Web unprivileged and warnings owned by Type.
- Bind ACL operations to verified device descriptors and preserve prior permissions when revoking the grant.

### Upgrade notes
- After updating, approve Allow keyboard access once to replace an old temporary grant with persistent consent. Existing grants are not silently made permanent.
- Linux requires polkit, Python 3, udev and ACL tools. Actual polkit/udev boot integration must be verified on the target desktop; automated tests simulate reboot, hotplug and revocation.
- Windows desktop capture is unchanged.

## [v0.4.3]

Includes changes from v0.4.0 through v0.4.3.

### Features
- Layout-aware native adapters for X11, Hyprland, Sway and Windows.
- Optional multilingual word frequencies with background/trainer/language filters and marked/excluded word lists.
- Active typing time, corrections, bursts, long pauses and longest-burst statistics.
- Active-interval typing speed with configurable idle-pause exclusion.
- Type-owned schemas, queries and retention over a compatible replaceable Storage component.

### Improvements
- Explain disabled/paused capture, permissions, missing decoders, unsupported IME, unfinished words and empty filters.
- Provide an explicit Type-owned enable-word-capture action with its privacy notice.
- Improve completed-word delivery and cover singleton words, decoder status and trainer routing with regression tests.

### Bug Fixes
- Count completed words from their first occurrence; do not require repeated words.
- Do not treat an unfinished token or a pause by itself as a completed word.
- Preserve non-ASCII Windows input with UTF-8 helper output.
- Match trainer HTTP routes by pathname so query strings do not cause 404 errors.
- Keep saved word history readable when new capture is paused or disabled.
- Align root/UI manifest and package/lockfile versions to fix the superseded v0.4.0/v0.4.1 packaging builds.

### Security
- Require separate Type-owned consent before saving word frequencies; provide retention and private-history controls.

### Notes
- Word reconstruction depends on active-layout/input-method support. Paste, IME commits and cursor edits are not reliably represented as final document text.
- Passwords and sensitive fields cannot always be recognized or excluded.

### Installation
- Requires Delta 0.3 and Node.js 22.12 or later. Use the official plugin catalog for current installations; verify manually downloaded assets against `SHA256SUMS`.

**Full Changelog:** https://github.com/n-ycta/delta_type/compare/v0.3.1...v0.4.3

## [v0.3.1]

Includes changes from v0.3.0 through v0.3.1.

### Features
- Default Linux background typing statistics through evdev, with separate trainer/background mode filters.
- Optional local physical-key history with retention/cleanup controls.
- Type-owned recording consent, status warnings and generic authorization actions.
- Request/revoke keyboard-device ACLs through explicit local OS approval.

### Improvements
- Report missing polkit, Python and ACL prerequisites and cover the permission helper with regression tests.

### Security
- A Web action requests OS approval rather than silently granting keyboard access.
- Keep Web unprivileged and validate input devices in the permission helper.
- Detailed recording is optional; captured input may include sensitive information.

### Notes
- Physical evdev events alone do not identify the active layout or reliably reconstruct final document text.

### Installation
- Requires Delta 0.3 and Node.js 22.12 or later. Use the official plugin catalog for current installations; verify manually downloaded assets against `SHA256SUMS`.

**Full Changelog:** https://github.com/n-ycta/delta_type/compare/v0.2.1...v0.3.1

## [v0.2.1]

Includes changes from v0.2.0 through v0.2.1.

### Features
- Optional typing trainer and authenticated client-submitted statistics.
- RU/EN aggregate metrics, durable queued delivery and replaceable local/hub Storage.
- English/Russian plugin presentation and explicit capability/session input schemas.

### Bug Fixes
- Bind submitted records to authenticated node identity.
- Roll back queue state when local persistence fails.

### Notes
- This line uses trainer/client submissions; background keyboard statistics arrive in v0.3.x.

### Installation
- Requires Delta 0.3 and Node.js 22.12 or later. Use the official plugin catalog for current installations; verify manually downloaded assets against `SHA256SUMS`.

**Source:** https://github.com/n-ycta/delta_type/tree/v0.2.1

