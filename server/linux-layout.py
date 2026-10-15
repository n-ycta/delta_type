"""Unprivileged decoder. Uses compositor/X11 layout state; never guesses a language from text."""
import ctypes as C
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import shutil
import time
import sys
import xml.etree.ElementTree as ET

CAPTURE = '--words' in sys.argv
try:
    lib = C.CDLL('libxkbcommon.so.0')
except OSError:
    print(json.dumps({'decoderState':'unavailable','decoderReason':'libxkbcommon_missing'}),flush=True)
    sys.exit(1)
class Names(C.Structure):
    _fields_ = [(n, C.c_char_p) for n in ('rules','model','layout','variant','options')]
for name,args,result in [('xkb_context_new',[C.c_int],C.c_void_p),('xkb_keymap_new_from_names',[C.c_void_p,C.POINTER(Names),C.c_int],C.c_void_p),('xkb_state_new',[C.c_void_p],C.c_void_p),('xkb_state_update_key',[C.c_void_p,C.c_uint,C.c_int],C.c_uint),('xkb_state_key_get_utf8',[C.c_void_p,C.c_uint,C.c_char_p,C.c_size_t],C.c_int),('xkb_state_mod_name_is_active',[C.c_void_p,C.c_char_p,C.c_uint],C.c_int),('xkb_state_unref',[C.c_void_p],None),('xkb_keymap_unref',[C.c_void_p],None),('xkb_state_update_mask',[C.c_void_p,C.c_uint,C.c_uint,C.c_uint,C.c_uint,C.c_uint,C.c_uint],C.c_uint)]:
    fn=getattr(lib,name);fn.argtypes=args;fn.restype=result
context=lib.xkb_context_new(0)
compose=None
try:
    for name,args,result in [('xkb_state_key_get_one_sym',[C.c_void_p,C.c_uint],C.c_uint),('xkb_compose_table_new_from_locale',[C.c_void_p,C.c_char_p,C.c_int],C.c_void_p),('xkb_compose_state_new',[C.c_void_p,C.c_int],C.c_void_p),('xkb_compose_state_feed',[C.c_void_p,C.c_uint],C.c_int),('xkb_compose_state_get_status',[C.c_void_p],C.c_int),('xkb_compose_state_get_utf8',[C.c_void_p,C.c_char_p,C.c_size_t],C.c_int),('xkb_compose_state_reset',[C.c_void_p],None)]:
        fn=getattr(lib,name);fn.argtypes=args;fn.restype=result
    table=lib.xkb_compose_table_new_from_locale(context,b'C.UTF-8',0)
    if table:compose=lib.xkb_compose_state_new(table,0)
except AttributeError:pass

layouts={}
try:
    root=ET.parse('/usr/share/X11/xkb/rules/base.xml').getroot()
    for layout in root.findall('.//layoutList/layout'):
        cfg=layout.find('configItem');base=cfg.findtext('name');lang=cfg.findtext('languageList/iso639Id') or 'unknown'
        for item,variant in [(cfg,'')]+[(v.find('configItem'),v.findtext('configItem/name')) for v in layout.findall('variantList/variant')]:
            desc=item.findtext('description');language=item.findtext('languageList/iso639Id') or lang
            layouts.setdefault(desc,[]).append((base,variant or '',language))
except (OSError,ET.ParseError):pass
runtime=Path(os.environ.get('XDG_RUNTIME_DIR','/run/user/'+str(os.getuid())))
def ipc(path,command):
    with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as s:
        s.settimeout(.4);s.connect(str(path));s.sendall(command.encode());s.shutdown(socket.SHUT_WR);data=b''
        while True:
            b=s.recv(65536)
            if not b:break
            data+=b
            if len(data)>2000000:raise ValueError('IPC response too large')
        return json.loads(data)
def from_description(desc):
    choices=layouts.get(desc,[])
    return choices[0] if len(choices)==1 else None
class XState(C.Structure):
    _fields_=[('group',C.c_ubyte),('locked_group',C.c_ubyte),('base_group',C.c_ushort),('latched_group',C.c_ushort),('mods',C.c_ubyte),('base_mods',C.c_ubyte),('latched_mods',C.c_ubyte),('locked_mods',C.c_ubyte),('compat_state',C.c_ubyte),('grab_mods',C.c_ubyte),('compat_grab_mods',C.c_ubyte),('lookup_mods',C.c_ubyte),('compat_lookup_mods',C.c_ubyte),('ptr_buttons',C.c_ushort)]
xlib=None;display=None
if os.environ.get('DISPLAY'):
    try:
        xlib=C.CDLL('libX11.so.6');xlib.XOpenDisplay.argtypes=[C.c_char_p];xlib.XOpenDisplay.restype=C.c_void_p;display=xlib.XOpenDisplay(None)
        xlib.XDefaultRootWindow.argtypes=[C.c_void_p];xlib.XDefaultRootWindow.restype=C.c_ulong
        xlib.XInternAtom.argtypes=[C.c_void_p,C.c_char_p,C.c_int];xlib.XInternAtom.restype=C.c_ulong
        xlib.XGetWindowProperty.argtypes=[C.c_void_p,C.c_ulong,C.c_ulong,C.c_long,C.c_long,C.c_int,C.c_ulong,C.POINTER(C.c_ulong),C.POINTER(C.c_int),C.POINTER(C.c_ulong),C.POINTER(C.c_ulong),C.POINTER(C.c_void_p)]
        xlib.XFree.argtypes=[C.c_void_p];xlib.XkbGetState.argtypes=[C.c_void_p,C.c_uint,C.POINTER(XState)];xlib.XGetInputFocus.argtypes=[C.c_void_p,C.POINTER(C.c_ulong),C.POINTER(C.c_int)]
    except OSError:display=None

def active(device=''):
    paths=list((runtime/'hypr').glob('*/.socket.sock'))
    if os.environ.get('HYPRLAND_INSTANCE_SIGNATURE'):
        exact=runtime/'hypr'/os.environ['HYPRLAND_INSTANCE_SIGNATURE']/'.socket.sock'
        paths=[exact] if exact.exists() else paths
    # Do not choose between multiple compositor sessions by guesswork.
    if len(paths)==1:
        keyboards=ipc(paths[0],'j/devices').get('keyboards',[])
        normalized=lambda s:re.sub(r'[^a-z0-9]+','-',s.lower()).strip('-')
        matching=[k for k in keyboards if normalized(k.get('name',''))==normalized(device)]
        candidates=matching or ([keyboards[0]] if len(keyboards)==1 else [])
        if len(candidates)!=1:raise ValueError('ambiguous_keyboard')
        k=candidates[0];desc=k.get('active_keymap');layout=from_description(desc)
        if not layout:raise ValueError('layout_metadata_unavailable')
        window=ipc(paths[0],'j/activewindow').get('address','')
        return (*layout,k.get('options',''),'hyprland',window,None)
    sockets=list(runtime.glob('sway-ipc.*.sock'))
    if os.environ.get('SWAYSOCK'):sockets=[Path(os.environ['SWAYSOCK'])]
    if len(sockets)==1 and Path('/usr/bin/swaymsg').exists():
        env={**os.environ,'SWAYSOCK':str(sockets[0])}
        inputs=json.loads(subprocess.check_output(['/usr/bin/swaymsg','-r','-t','get_inputs'],env=env,timeout=.5))
        ks=[k for k in inputs if k.get('type')=='keyboard'];matching=[k for k in ks if k.get('name')==device];ks=matching or ks
        names={k.get('xkb_active_layout_name') for k in ks}
        if len(names)!=1:raise ValueError('ambiguous_keyboard')
        layout=from_description(next(iter(names)))
        if not layout:raise ValueError('layout_metadata_unavailable')
        tree=json.loads(subprocess.check_output(['/usr/bin/swaymsg','-r','-t','get_tree'],env=env,timeout=.5))
        def focused(n):
            if n.get('focused'):return str(n.get('id',''))
            for child in n.get('nodes',[])+n.get('floating_nodes',[]):
                found=focused(child)
                if found:return found
            return ''
        return (*layout,'','sway',focused(tree),None)
    if display:
        actual=C.c_ulong();fmt=C.c_int();n=C.c_ulong();after=C.c_ulong();ptr=C.c_void_p()
        atom=xlib.XInternAtom(display,b'_XKB_RULES_NAMES',0)
        xlib.XGetWindowProperty(display,xlib.XDefaultRootWindow(display),atom,0,1024,0,0,C.byref(actual),C.byref(fmt),C.byref(n),C.byref(after),C.byref(ptr))
        if not ptr:raise ValueError('x11_keymap_unavailable')
        data=C.string_at(ptr,n.value).decode().split('\0');xlib.XFree(ptr)
        state=XState();xlib.XkbGetState(display,0x0100,C.byref(state));group=state.group
        layout=data[2].split(',')[group];variants=data[3].split(',');variant=variants[group] if group<len(variants) else ''
        language=next((v[2] for values in layouts.values() for v in values if v[0]==layout and v[1]==variant),'unknown')
        focus=C.c_ulong();revert=C.c_int();xlib.XGetInputFocus(display,C.byref(focus),C.byref(revert))
        return layout,variant,language,data[4],'x11',str(focus.value),state
    raise ValueError('unsupported_desktop_session')

ime_checked=0;ime_active=False
def input_method_active():
    global ime_checked,ime_active
    if time.monotonic()-ime_checked<.5:return ime_active
    ime_checked=time.monotonic();ime_active=False
    # IME engines emit committed text unavailable to raw evdev. Never count drafts as words.
    for command in ('fcitx5-remote','fcitx-remote'):
        path=shutil.which(command)
        if path:
            try:
                state=subprocess.check_output([path],timeout=.2).decode().strip()
                if state=='2':
                    engine=subprocess.check_output([path,'-n'],timeout=.2).decode().strip()
                    if not engine.startswith('keyboard-'):ime_active=True
            except (OSError,subprocess.SubprocessError):pass
    path=shutil.which('ibus')
    if path:
        try:
            engine=subprocess.check_output([path,'engine'],stderr=subprocess.DEVNULL,timeout=.2).decode().strip()
            if engine and not engine.startswith('xkb:'):ime_active=True
        except (OSError,subprocess.SubprocessError):pass
    return ime_active
keymap=None;state=None;key=None;held=set();last_focus=None
for line in sys.stdin:
    try:
        e=json.loads(line);code=int(e['code']);value=int(e['value']);device=e.get('device','');result={**e,'language':'unknown','decoderState':'unavailable'}
        if value==0:held.discard(code)
        else:held.add(code)
        try:
            layout,variant,language,options,provider,focus,xstate=active(device)
            spec=(layout,variant,options)
            if compose and (spec!=key or focus!=last_focus):lib.xkb_compose_state_reset(compose)
            last_focus=focus
            if spec!=key:
                if state:lib.xkb_state_unref(state)
                if keymap:lib.xkb_keymap_unref(keymap)
                names=Names(None,None,layout.encode(),variant.encode(),options.encode());keymap=lib.xkb_keymap_new_from_names(context,C.byref(names),0)
                if not keymap:raise ValueError('keymap_compile_failed')
                state=lib.xkb_state_new(keymap);key=spec
                for down in held-{code}:lib.xkb_state_update_key(state,down+8,1)
            if xstate:lib.xkb_state_update_mask(state,xstate.base_mods,xstate.latched_mods,xstate.locked_mods,0,0,0)
            if value!=2:lib.xkb_state_update_key(state,code+8,1 if value else 0)
            command=any(lib.xkb_state_mod_name_is_active(state,m,1<<3)>0 for m in [b'Control',b'Mod4',b'Mod1'])
            result.update(language=language,focus=focus,decoderState='ready',provider=provider,command=command,backspace=code==14,navigation=code in [102,103,104,105,106,107,108,109,110,111])
            if CAPTURE and input_method_active():
                result['navigation']=True;result['decoderReason']='ime_committed_text_unavailable'
            elif CAPTURE and value and not command:
                b=C.create_string_buffer(64);lib.xkb_state_key_get_utf8(state,code+8,b,len(b))
                if compose and code not in [29,42,54,56,58,97,100,125,126]:
                    lib.xkb_compose_state_feed(compose,lib.xkb_state_key_get_one_sym(state,code+8));status=lib.xkb_compose_state_get_status(compose)
                    if status==1:b.value=b''
                    elif status==2:lib.xkb_compose_state_get_utf8(compose,b,len(b));lib.xkb_compose_state_reset(compose)
                    elif status==3:b.value=b'';lib.xkb_compose_state_reset(compose);result['navigation']=True
                result['text']=b.value.decode('utf8','replace')
        except Exception as exc:result['decoderReason']=str(exc)[:100]
        print(json.dumps(result,ensure_ascii=False),flush=True)
    except Exception:print(json.dumps({'decoderState':'error','decoderReason':'invalid_event'}),flush=True)
