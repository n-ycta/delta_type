"""Explicit polkit grant installs a narrow, revocable keyboard-only udev policy.

The installed root-owned helper runs briefly on input-device creation, not as a
root daemon. Never invoke user code, modify the input group, or widen ACL masks.
"""
from contextlib import contextmanager
import fcntl
import json
import os
import re
import stat
import subprocess
import sys
from pathlib import Path

RUNTIME = Path('/run/delta-type-input-access')
POLICIES = Path('/var/lib/delta-type-input-access')
RULES = Path('/etc/udev/rules.d')
HELPERS = Path('/usr/local/libexec/delta-type-input-access')
UDEVADM = '/usr/bin/udevadm'


def keyboard_names():
    for entry in Path('/sys/class/input').glob('event*'):
        if not re.fullmatch(r'event[0-9]+', entry.name):
            continue
        try:
            bits = int((entry / 'device/capabilities/key').read_text().split()[-1], 16)
            if bits & (1 << 30) and bits & (1 << 28):
                yield entry.name
        except (OSError, ValueError, IndexError):
            continue


def checked_device(name):
    if not re.fullmatch(r'event[0-9]+', name):
        raise ValueError('Invalid input device')
    path = Path('/dev/input') / name
    if path.resolve() != path:
        raise ValueError('Symlink input device refused')
    info = path.lstat()
    if not stat.S_ISCHR(info.st_mode) or info.st_uid != 0:
        raise ValueError('Not a root-owned input character device')
    return path, info


def command(*args, pass_fds=()):
    return subprocess.run(args, check=True, text=True, capture_output=True,
                          env={'PATH': '/usr/bin:/bin', 'LC_ALL': 'C'}, timeout=10, pass_fds=pass_fds).stdout


def acl_entry(text, uid):
    match = re.search(r'^user:' + str(uid) + r':([rwx-]{3})(?:[ \t]+#effective:[rwx-]{3})?$', text, re.M)
    return match[1] if match else None


def secure_dir(path, mode=0o700):
    # Check every ancestor; a root-owned leaf inside a writable parent is unsafe.
    if path.parent != path:
        secure_dir(path.parent, 0o755)
    try:
        path.mkdir(mode=mode)
    except FileExistsError:
        pass
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
        raise ValueError('Unsafe root state directory')
    if mode == 0o700 and stat.S_IMODE(info.st_mode) != mode:
        raise ValueError('Unsafe private state directory')


def read_private(path, default):
    try:
        info = path.lstat()
    except FileNotFoundError:
        return default
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or stat.S_IMODE(info.st_mode) != 0o600:
        raise ValueError('Unsafe private state file')
    return json.loads(path.read_text())


def atomic_write(path, text, mode=0o600):
    # The parent is checked root-owned and non-writable before any writes.
    temporary = path.with_name(path.name + '.tmp.' + str(os.getpid()))
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    try:
        with os.fdopen(fd, 'w') as out:
            out.write(text)
            out.flush()
            os.fsync(out.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def helper_source():
    # pkexec invokes Python -I -c SOURCE; udev invokes the installed file.
    if '-c' in sys.orig_argv:
        return sys.orig_argv[sys.orig_argv.index('-c') + 1]
    return Path(__file__).read_text()


def rule_for(uid):
    return ('# Delta Type: persistent read-only access, explicitly approved by this user.\n'
            'ACTION=="remove", GOTO="delta_type_end_' + str(uid) + '"\n'
            'SUBSYSTEM=="input", KERNEL=="event[0-9]*", ENV{ID_INPUT_KEYBOARD}=="1", '
            'RUN+="/usr/bin/python3 -I ' + str(HELPERS / 'keyboard-acl.py') + ' device ' + str(uid) + ' %k"\n'
            'LABEL="delta_type_end_' + str(uid) + '"\n')


@contextmanager
def device_acl(name):
    path, expected = checked_device(name)
    fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW)
    try:
        info = os.fstat(fd)
        if (not stat.S_ISCHR(info.st_mode) or info.st_uid != 0 or
                info.st_ino != expected.st_ino or info.st_rdev != expected.st_rdev):
            raise ValueError('Input device changed during authorization')
        # Pass an opened descriptor to ACL tools; recycled paths cannot retarget it.
        yield '/proc/self/fd/' + str(fd), info, (fd,)
    finally:
        os.close(fd)


def grant_device(uid, name, old, state_path):
    # Also verify capabilities in sysfs; the udev match is not the trust boundary.
    if name not in set(keyboard_names()):
        return 0
    with device_acl(name) as (path, info, fds):
        current = command('/usr/bin/getfacl', '-cpn', '--', path, pass_fds=fds)
        entry = acl_entry(current, uid)
        if entry and 'r' in entry:
            return 0
        mask = re.search(r'^mask::([rwx-]{3})$', current, re.M) or re.search(r'^group::([rwx-]{3})$', current, re.M)
        if not mask or 'r' not in mask[1]:
            raise ValueError('Restrictive device ACL mask; system administrator policy required')
        record = old.get(name)
        if not record or record['rdev'] != info.st_rdev or record['ino'] != info.st_ino:
            old[name] = {'rdev': info.st_rdev, 'ino': info.st_ino, 'before': entry}
            atomic_write(state_path, json.dumps(old))
        command('/usr/bin/setfacl', '-n', '-m', 'u:' + str(uid) + ':r--', '--', path, pass_fds=fds)
        return 1


def revoke_devices(uid, old, state_path):
    changed = 0
    for name, record in list(old.items()):
        try:
            with device_acl(name) as (path, info, fds):
                current = command('/usr/bin/getfacl', '-cpn', '--', path, pass_fds=fds)
                entry = acl_entry(current, uid)
                # Never touch recycled event numbers or externally changed ACLs.
                if info.st_rdev == record['rdev'] and info.st_ino == record['ino'] and entry == 'r--':
                    if record['before'] is None:
                        command('/usr/bin/setfacl', '-n', '-x', 'u:' + str(uid), '--', path, pass_fds=fds)
                    else:
                        command('/usr/bin/setfacl', '-n', '-m', 'u:' + str(uid) + ':' + record['before'], '--', path, pass_fds=fds)
                    changed += 1
        except FileNotFoundError:
            pass
        old.pop(name, None)
        atomic_write(state_path, json.dumps(old))
    return changed


def validate_tools():
    for binary in ('/usr/bin/python3', '/usr/bin/getfacl', '/usr/bin/setfacl', UDEVADM):
        info = os.stat(binary)
        if info.st_uid != 0 or info.st_mode & 0o022 or not stat.S_ISREG(info.st_mode):
            raise ValueError('Untrusted system tool')


def main():
    if os.geteuid() != 0:
        raise ValueError('OS authorization required')
    device_event = len(sys.argv) == 4 and sys.argv[1] == 'device'
    raw_uid = sys.argv[2] if device_event else os.environ.get('PKEXEC_UID', '')
    if not re.fullmatch(r'[1-9][0-9]*', raw_uid):
        raise ValueError('An authenticated non-root requesting user is required')
    uid = int(raw_uid)
    if uid > 4294967294:
        raise ValueError('Invalid requesting user')
    if not device_event and (len(sys.argv) != 2 or sys.argv[1] not in ('grant', 'revoke')):
        raise ValueError('Invalid action')
    if device_event and not re.fullmatch(r'event[0-9]+', sys.argv[3]):
        raise ValueError('Invalid input device')
    validate_tools()
    for directory in (RUNTIME, POLICIES):
        secure_dir(directory)
    lock_fd = os.open(RUNTIME / '.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(lock_fd, 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        state_path, policy_path = RUNTIME / (str(uid) + '.json'), POLICIES / (str(uid) + '.json')
        old = read_private(state_path, {})
        prior_records = dict(old)
        policy = read_private(policy_path, None)
        rule = RULES / ('71-delta-type-input-' + str(uid) + '.rules')
        if device_event:
            # Cached/in-flight udev rules cannot regrant after revocation.
            if not policy or policy.get('uid') != uid or policy.get('version') != 1:
                return
            grant_device(uid, sys.argv[3], old, state_path)
            return
        secure_dir(RULES, 0o755)
        changed = 0
        if sys.argv[1] == 'grant':
            secure_dir(HELPERS, 0o755)
            atomic_write(HELPERS / 'keyboard-acl.py', helper_source())
            atomic_write(policy_path, json.dumps({'uid': uid, 'version': 1}))
            atomic_write(rule, rule_for(uid), 0o644)
            try:
                command(UDEVADM, 'control', '--reload-rules')
                for name in keyboard_names():
                    try:
                        changed += grant_device(uid, name, old, state_path)
                    except FileNotFoundError:
                        continue
            except Exception:
                # Roll back a new grant, including its future hotplug authority.
                if policy is None:
                    policy_path.unlink(missing_ok=True)
                    rule.unlink(missing_ok=True)
                    try:
                        command(UDEVADM, 'control', '--reload-rules')
                    finally:
                        newly_added = {name: record for name, record in old.items() if name not in prior_records or prior_records[name] != record}
                        revoke_devices(uid, newly_added, state_path)
                        atomic_write(state_path, json.dumps(prior_records))
                raise
        else:
            # Disable authority first, even if udev reload later fails.
            policy_path.unlink(missing_ok=True)
            rule.unlink(missing_ok=True)
            try:
                command(UDEVADM, 'control', '--reload-rules')
            finally:
                changed = revoke_devices(uid, old, state_path)
        print(json.dumps({'ok': True, 'changed': changed, 'until': 'revoked', 'persistent': True}))


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print(json.dumps({'ok': False, 'error': str(exc)}))
        sys.exit(1)
