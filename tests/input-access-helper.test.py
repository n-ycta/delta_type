import importlib.util
import json
import os
from contextlib import contextmanager, ExitStack
from pathlib import Path
import shutil
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
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.addCleanup(self.temp.cleanup)
        self.acl = {'event2': None}
        self.identities = {'event2': (13, 42)}
        self.names = ['event2']
        self.commands = []
        self.mask = 'rw-'
        self.fail_reload = False
        for name in ('RUNTIME', 'POLICIES', 'RULES', 'HELPERS'):
            self.stack.enter_context(patch.object(helper, name, self.root / name))
        self.stack.enter_context(patch.object(helper.os, 'geteuid', return_value=0))
        self.stack.enter_context(patch.dict(helper.os.environ, {'PKEXEC_UID': '1000'}, clear=True))
        self.stack.enter_context(patch.object(helper.sys, 'argv', ['helper', 'grant']))
        self.stack.enter_context(patch.object(helper, 'validate_tools'))
        self.stack.enter_context(patch.object(helper, 'helper_source', return_value='# fixed helper fixture'))
        self.stack.enter_context(patch.object(helper, 'secure_dir', side_effect=lambda p, mode=0o700: p.mkdir(mode=mode, parents=True, exist_ok=True)))
        self.stack.enter_context(patch.object(helper, 'keyboard_names', side_effect=lambda: iter(self.names)))
        original_lstat = Path.lstat
        def root_lstat(path):
            info = original_lstat(path)
            return SimpleNamespace(st_mode=info.st_mode, st_uid=0, st_ino=info.st_ino, st_rdev=info.st_rdev)
        self.stack.enter_context(patch.object(Path, 'lstat', root_lstat))
        @contextmanager
        def device(name):
            if name not in self.identities:
                raise FileNotFoundError(name)
            rdev, ino = self.identities[name]
            yield '/fixture/' + name, SimpleNamespace(st_rdev=rdev, st_ino=ino), (123,)
        self.stack.enter_context(patch.object(helper, 'device_acl', side_effect=device))
        self.stack.enter_context(patch.object(helper, 'command', side_effect=self.command))

    def command(self, *args, pass_fds=()):
        self.commands.append(args)
        if args[0].endswith('udevadm'):
            self.assertEqual(args[1:], ('control', '--reload-rules'))
            if self.fail_reload:
                raise ValueError('udev reload failed')
            return ''
        self.assertEqual(pass_fds, (123,), 'ACL tools must target an inherited device descriptor')
        name = args[-1].split('/')[-1]
        if args[0].endswith('getfacl'):
            before = self.acl[name]
            return 'user::rw-\ngroup::rw-\nmask::' + self.mask + '\nother::---\n' + ('user:1000:' + before + '\n' if before is not None else '')
        self.assertEqual(args[1], '-n', 'Never recalculate or broaden the mask')
        self.assertEqual(args[-2], '--')
        if args[2] == '-m':
            self.assertEqual(args[3].split(':')[:2], ['u', '1000'])
            self.acl[name] = args[3].split(':')[-1]
        else:
            self.assertEqual(args[2:4], ('-x', 'u:1000'))
            self.acl[name] = None
        return ''

    def action(self, *args):
        helper.sys.argv = ['helper', *args]
        helper.main()

    def test_grant_regrant_revoke_preserves_previous_acl_and_mask(self):
        for previous in [None, '-w-', 'r--']:
            self.acl['event2'] = previous
            self.action('grant')
            self.assertEqual(self.acl['event2'], 'r--')
            state = helper.read_private(helper.RUNTIME / '1000.json', {})
            self.action('grant')
            self.assertEqual(helper.read_private(helper.RUNTIME / '1000.json', {}), state)
            self.action('revoke')
            self.assertEqual(self.acl['event2'], previous)
            self.assertFalse((helper.POLICIES / '1000.json').exists())
            self.assertFalse((helper.RULES / '71-delta-type-input-1000.rules').exists())

    def test_reboot_and_new_event_number_reapply_without_pkexec(self):
        self.action('grant')
        shutil.rmtree(helper.RUNTIME)  # /run and device ACLs disappear at reboot.
        self.names = ['event8']
        self.acl = {'event8': None}
        self.identities = {'event8': (99, 88)}
        with patch.dict(helper.os.environ, {}, clear=True):
            self.action('device', '1000', 'event8')
        self.assertEqual(self.acl['event8'], 'r--')
        self.assertIsNone(helper.read_private(helper.RUNTIME / '1000.json', {})['event8']['before'])
        self.action('revoke')
        self.assertIsNone(self.acl['event8'])
        # A previously queued/cached udev invocation cannot resurrect access.
        with patch.dict(helper.os.environ, {}, clear=True):
            self.action('device', '1000', 'event8')
        self.assertIsNone(self.acl['event8'])

    def test_hotplug_nonkeyboard_and_other_uid_never_granted(self):
        self.action('grant')
        self.identities['event9'] = (9, 90)
        self.acl['event9'] = None
        self.action('device', '1000', 'event9')
        self.assertIsNone(self.acl['event9'])
        self.names.append('event9')
        self.action('device', '1001', 'event9')
        self.assertIsNone(self.acl['event9'])
        self.action('device', '1000', 'event9')
        self.assertEqual(self.acl['event9'], 'r--')

    def test_recycled_event_and_externally_changed_acl_are_not_reverted(self):
        self.action('grant')
        self.identities['event2'] = (13, 43)
        self.acl['event2'] = 'rw-'
        self.action('revoke')
        self.assertEqual(self.acl['event2'], 'rw-')

    def test_failed_upgrade_keeps_legacy_temporary_acl(self):
        helper.RUNTIME.mkdir(mode=0o700)
        old = {'event2': {'rdev': 13, 'ino': 42, 'before': None}}
        helper.atomic_write(helper.RUNTIME / '1000.json', json.dumps(old))
        self.acl['event2'] = 'r--'
        self.fail_reload = True
        with self.assertRaises(ValueError):
            self.action('grant')
        self.assertEqual(self.acl['event2'], 'r--')
        self.assertEqual(helper.read_private(helper.RUNTIME / '1000.json', {}), old)

    def test_restrictive_mask_rolls_back_new_persistent_policy(self):
        self.mask = '-w-'
        with self.assertRaisesRegex(ValueError, 'mask'):
            self.action('grant')
        self.assertIsNone(self.acl['event2'])
        self.assertFalse((helper.POLICIES / '1000.json').exists())
        self.assertFalse((helper.RULES / '71-delta-type-input-1000.rules').exists())

    def test_failed_rule_reload_rolls_back_and_revocation_disables_cached_rules(self):
        self.fail_reload = True
        with self.assertRaises(ValueError):
            self.action('grant')
        self.assertFalse((helper.POLICIES / '1000.json').exists())
        self.fail_reload = False
        self.action('grant')
        self.fail_reload = True
        with self.assertRaises(ValueError):
            self.action('revoke')
        self.assertIsNone(self.acl['event2'])
        self.action('device', '1000', 'event2')
        self.assertIsNone(self.acl['event2'])

    def test_rule_is_uid_bound_keyboard_only_and_no_shell_or_device_write(self):
        self.action('grant')
        rule = (helper.RULES / '71-delta-type-input-1000.rules').read_text()
        self.assertIn('ENV{ID_INPUT_KEYBOARD}=="1"', rule)
        self.assertIn(' device 1000 %k', rule)
        self.assertNotIn('sh -c', rule)
        self.assertEqual(stat.S_IMODE((helper.POLICIES / '1000.json').stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE((helper.HELPERS / 'keyboard-acl.py').stat().st_mode), 0o600)

    def test_no_keyboard_yet_can_be_authorized_for_later_hotplug(self):
        self.names = []
        self.action('grant')
        self.assertTrue((helper.POLICIES / '1000.json').exists())
        self.names = ['event2']
        self.action('device', '1000', 'event2')
        self.assertEqual(self.acl['event2'], 'r--')

    def test_private_policy_symlink_is_rejected(self):
        helper.POLICIES.mkdir(mode=0o700)
        target = self.root / 'untrusted.json'
        target.write_text('{"uid":1000,"version":1}')
        (helper.POLICIES / '1000.json').symlink_to(target)
        with self.assertRaisesRegex(ValueError, 'Unsafe private state file'):
            self.action('device', '1000', 'event2')
        self.assertIsNone(self.acl['event2'])

    def test_temporary_file_symlink_cannot_overwrite_a_target(self):
        helper.RUNTIME.mkdir(mode=0o700)
        target = self.root / 'target'
        target.write_text('untouched')
        state = helper.RUNTIME / '1000.json'
        state.with_name(state.name + '.tmp.' + str(os.getpid())).symlink_to(target)
        with self.assertRaises(FileExistsError):
            helper.atomic_write(state, 'new state')
        self.assertEqual(target.read_text(), 'untouched')

    def test_effective_acl_comments_do_not_erase_prior_entry(self):
        self.assertEqual(helper.acl_entry('user:1000:-w-\t#effective:---\n', 1000), '-w-')

    def test_privilege_and_requester_checks(self):
        with patch.object(helper.os, 'geteuid', return_value=1000):
            with self.assertRaisesRegex(ValueError, 'OS authorization'):
                helper.main()
        for uid in ['', '0', '-1', '1000;sh']:
            with patch.dict(helper.os.environ, {'PKEXEC_UID': uid}, clear=True):
                with self.assertRaisesRegex(ValueError, 'requesting user'):
                    helper.main()


if __name__ == '__main__':
    unittest.main()
