"""Run ONLY after explicit pkexec authorization. No persistent root helper or broad input group."""
import json
import os
import re
import stat
import subprocess
import sys
from pathlib import Path


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


def command(*args):
    return subprocess.run(args, check=True, text=True, capture_output=True,
                          env={'PATH': '/usr/bin:/bin', 'LC_ALL': 'C'}, timeout=10).stdout


def acl_entry(text, uid):
    match = re.search(r'^user:' + str(uid) + r':([rwx-]{3})(?:[ \t]+#effective:[rwx-]{3})?$', text, re.M)
    return match[1] if match else None


def main():
    if os.geteuid() != 0:
        raise ValueError('OS authorization required')
    raw_uid = os.environ.get('PKEXEC_UID', '')
    if not re.fullmatch(r'[1-9][0-9]*', raw_uid):
        raise ValueError('An authenticated non-root requesting user is required')
    uid = int(raw_uid)
    if len(sys.argv) != 2 or sys.argv[1] not in ('grant', 'revoke'):
        raise ValueError('Invalid action')
    for binary in ('/usr/bin/getfacl', '/usr/bin/setfacl'):
        s = os.stat(binary)
        if s.st_uid != 0 or s.st_mode & 0o022:
            raise ValueError('Untrusted ACL tool')
    state_dir = Path('/run/delta-type-input-access')
    try:
        state_dir.mkdir(mode=0o700)
    except FileExistsError:
        pass
    ds = state_dir.lstat()
    if not stat.S_ISDIR(ds.st_mode) or ds.st_uid != 0 or stat.S_IMODE(ds.st_mode) != 0o700:
        raise ValueError('Unsafe runtime state directory')
    state_path = state_dir / (str(uid) + '.json')
    old = json.loads(state_path.read_text()) if state_path.exists() else {}
    changed = 0
    names = list(keyboard_names()) if sys.argv[1] == 'grant' else list(old)
    for name in names:
        try:
            path, info = checked_device(name)
        except FileNotFoundError:
            old.pop(name, None)
            continue
        current = command('/usr/bin/getfacl', '-cpn', '--', str(path))
        entry = acl_entry(current, uid)
        if sys.argv[1] == 'grant':
            # Do not broaden the ACL mask: that could expose other users' latent permissions.
            mask = re.search(r'^(?:mask|group)::([rwx-]{3})$', current, re.M)
            explicit_mask = re.search(r'^mask::([rwx-]{3})$', current, re.M)
            if 'r' not in (explicit_mask or mask)[1]:
                raise ValueError('Restrictive device ACL mask; system administrator policy required')
            if entry and 'r' in entry:
                continue
            # Save recovery state before mutation, including device identity. State is root-only.
            old[name] = {'rdev': info.st_rdev, 'ino': info.st_ino, 'before': entry}
            state_path.write_text(json.dumps(old))
            os.chmod(state_path, 0o600)
            command('/usr/bin/setfacl', '-n', '-m', 'u:' + str(uid) + ':r--', '--', str(path))
            changed += 1
        else:
            record = old[name]
            # Leave changed permissions and recycled event numbers untouched.
            if info.st_rdev == record['rdev'] and info.st_ino == record['ino'] and entry == 'r--':
                if record['before'] is None:
                    command('/usr/bin/setfacl', '-n', '-x', 'u:' + str(uid), '--', str(path))
                else:
                    command('/usr/bin/setfacl', '-n', '-m', 'u:' + str(uid) + ':' + record['before'], '--', str(path))
                changed += 1
            old.pop(name, None)
            state_path.write_text(json.dumps(old))
    if sys.argv[1] == 'grant' and not names:
        raise ValueError('No keyboard devices found')
    print(json.dumps({'ok': True, 'changed': changed, 'until': 'device-reconnect-or-reboot'}))


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print(json.dumps({'ok': False, 'error': str(exc)}))
        sys.exit(1)
