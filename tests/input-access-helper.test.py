import importlib.util
import json
import os
from pathlib import Path
import stat
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True

spec = importlib.util.spec_from_file_location('helper', Path(__file__).resolve().parents[1] / 'server/input-access-helper.py')
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)


class HelperTest(unittest.TestCase):
    def test_grant_is_read_only_preserves_mask_and_revoke_restores_previous_entry(self):
        self.run_cycle(previous=None)
        self.run_cycle(previous='-w-')

    def run_cycle(self, previous):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp) / 'state'
            class RootPath(type(Path())):
                def lstat(self):
                    if str(self) == str(folder):
                        return SimpleNamespace(st_mode=stat.S_IFDIR | 0o700, st_uid=0)
                    return super().lstat()
            def root_path(path):
                return RootPath(folder) if path == '/run/delta-type-input-access' else Path(path)
            acl = {'entry': previous}
            commands = []
            def command(*args):
                commands.append(args)
                if args[0].endswith('getfacl'):
                    return 'user::rw-\ngroup::rw-\nmask::rw-\nother::---\n' + ('user:1000:' + acl['entry'] + '\n' if acl['entry'] is not None else '')
                self.assertEqual(args[1], '-n', 'Never recalculate/broaden ACL mask')
                self.assertEqual(args[-2], '--')
                if args[2] == '-m':
                    self.assertEqual(args[3].split(':')[:2], ['u', '1000'])
                    acl['entry'] = args[3].split(':')[-1]
                else:
                    self.assertEqual(args[2:4], ('-x', 'u:1000'))
                    acl['entry'] = None
                return ''
            old_stat = os.stat
            def tool_stat(path, *args, **kwargs):
                if str(path) in ('/usr/bin/getfacl', '/usr/bin/setfacl'):
                    return SimpleNamespace(st_uid=0, st_mode=0o100755)
                return old_stat(path, *args, **kwargs)
            with patch.object(helper, 'Path', root_path), patch.object(helper.os, 'geteuid', return_value=0), patch.dict(helper.os.environ, {'PKEXEC_UID': '1000'}, clear=True), patch.object(helper.sys, 'argv', ['helper', 'grant']), patch.object(helper.os, 'stat', side_effect=tool_stat), patch.object(helper, 'keyboard_names', return_value=['event2']), patch.object(helper, 'checked_device', return_value=(Path('/dev/input/event2'), SimpleNamespace(st_rdev=13, st_ino=42))), patch.object(helper, 'command', side_effect=command):
                helper.main()
                self.assertEqual(acl['entry'], 'r--')
                original = json.loads((folder / '1000.json').read_text())
                self.assertEqual(original['event2']['before'], previous)
                helper.main()  # Repeat request must preserve original ACL recovery record.
                self.assertEqual(json.loads((folder / '1000.json').read_text()), original)
                helper.sys.argv[1] = 'revoke'
                helper.main()
                self.assertEqual(acl['entry'], previous)
                self.assertEqual(json.loads((folder / '1000.json').read_text()), {})

    def test_effective_acl_comments_do_not_erase_prior_entry(self):
        self.assertEqual(helper.acl_entry('user:1000:-w-\t#effective:---\n',1000),'-w-')

    def test_privilege_and_requester_checks(self):
        with patch.object(helper.os, 'geteuid', return_value=1000):
            with self.assertRaisesRegex(ValueError, 'OS authorization'):
                helper.main()
        for uid in ['', '0', '-1', '1000;sh']:
            with patch.object(helper.os, 'geteuid', return_value=0), patch.dict(helper.os.environ, {'PKEXEC_UID': uid}, clear=True):
                with self.assertRaisesRegex(ValueError, 'requesting user'):
                    helper.main()


if __name__ == '__main__':
    unittest.main()
