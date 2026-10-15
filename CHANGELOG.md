# Changelog

## Release policy

- Collect compatible fixes in **Unreleased**; do not publish a separate release for every small commit.
- Publish tested, meaningful batches only after explicit maintainer approval.
- Before tagging, move the reviewed changes into a version section below. Release workflows require that section.
- Historical patch releases have been consolidated into the next retained release. Git tags remain available for source history and comparison links.

## [Unreleased]

- Improve release documentation and changelog-backed release publishing; no new runtime release is created for this maintenance change.

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

