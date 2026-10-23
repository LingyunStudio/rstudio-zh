#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
RStudio Desktop Simplified Chinese (zh_CN) Localization Installer & Restorer
============================================================================
Adds a native 3rd language option "中文 (简体)" (zh_CN) to RStudio Desktop
while preserving English (en) and French (fr) 100% intact.

Usage:
  python rstudio_zh.py install [--dir "D:\\RStudio"]
  python rstudio_zh.py restore [--dir "D:\\RStudio"]
  python rstudio_zh.py status  [--dir "D:\\RStudio"]
"""

import argparse
import gzip
import json
import os
import platform
import re
import shutil
import sys

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

REPO_DIR = os.path.dirname(os.path.abspath(__file__))
DICT_DIR = os.path.join(REPO_DIR, "dictionaries")


def find_rstudio_app_dir(custom_dir=None):
    """Locate RStudio's resources/app directory across Windows, macOS, and Linux."""
    candidates = []
    if custom_dir:
        candidates.append(custom_dir)
    if os.environ.get("RSTUDIO_DIR"):
        candidates.append(os.environ["RSTUDIO_DIR"])

    if platform.system() == "Windows":
        # Check Windows Registry
        try:
            import winreg
            for hive in (winreg.HKEY_LOCAL_MACHINE, winreg.HKEY_CURRENT_USER):
                for subkey in (
                    r"SOFTWARE\RStudio",
                    r"SOFTWARE\WOW6432Node\RStudio",
                    r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\RStudio",
                ):
                    try:
                        with winreg.OpenKey(hive, subkey) as k:
                            for val_name in ("Path", "InstallLocation", "UninstallString"):
                                try:
                                    v, _ = winreg.QueryValueEx(k, val_name)
                                    if v:
                                        v = v.strip('"')
                                        if v.lower().endswith(".exe"):
                                            v = os.path.dirname(v)
                                        candidates.append(v)
                                except OSError:
                                    pass
                    except OSError:
                        pass
        except ImportError:
            pass

        local_appdata = os.environ.get("LOCALAPPDATA", "")
        prog_files = os.environ.get("ProgramFiles", r"C:\Program Files")
        prog_files_x86 = os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")
        candidates.extend([
            os.path.join(prog_files, "RStudio"),
            os.path.join(local_appdata, "Programs", "RStudio") if local_appdata else "",
            r"D:\RStudio",
            r"C:\RStudio",
            r"E:\RStudio",
            os.path.join(prog_files_x86, "RStudio"),
        ])
    elif platform.system() == "Darwin":
        candidates.extend([
            "/Applications/RStudio.app/Contents/Resources/app",
            os.path.expanduser("~/Applications/RStudio.app/Contents/Resources/app"),
        ])
    else:
        candidates.extend([
            "/usr/lib/rstudio/resources/app",
            "/usr/lib/rstudio",
            "/opt/rstudio/resources/app",
            "/opt/rstudio",
        ])

    for c in candidates:
        if not c:
            continue
        c = os.path.abspath(c)
        # Check if c itself is resources/app or contains resources/app
        for app_path in (c, os.path.join(c, "resources", "app"), os.path.join(c, "Contents", "Resources", "app")):
            if os.path.isfile(os.path.join(app_path, "www", "rstudio", "rstudio.nocache.js")):
                return app_path
    return None


def detect_gwt_hash(app_dir):
    """Detect the GWT permutation hash (e.g. 6A01120AF983E4373AF305E18CA7A109) from rstudio.nocache.js."""
    nocache = os.path.join(app_dir, "www", "rstudio", "rstudio.nocache.js")
    txt = open(nocache, "r", encoding="utf-8").read()
    m = re.search(r"'([0-9A-F]{32})'", txt)
    if not m:
        raise RuntimeError(f"Could not find 32-char GWT hash in {nocache}")
    return m.group(1)


def get_target_rel_paths(app_dir, gwt_hash):
    """Return list of relative file paths under resources/app that are touched by the patch."""
    rels = [
        os.path.join("resources", "schema", "user-prefs-schema.json"),
        os.path.join("www", "rstudio", "rstudio.nocache.js"),
        os.path.join("www", "rstudio", f"{gwt_hash}.cache.js"),
        os.path.join("www", "rstudio", f"{gwt_hash}.cache.js.gz"),
        os.path.join(".webpack", "main", "index.js"),
        os.path.join(".webpack", "main", "assets", "locales", "en.json"),
        os.path.join(".webpack", "main", "assets", "locales", "fr.json"),
        os.path.join(".webpack", "renderer", "choose_r", "index.js"),
        os.path.join(".webpack", "renderer", "connect_window", "index.js"),
        os.path.join(".webpack", "renderer", "error_window", "index.js"),
        os.path.join(".webpack", "renderer", "loading_window", "index.js"),
        os.path.join(".webpack", "renderer", "assets", "locales", "en.json"),
        os.path.join(".webpack", "renderer", "assets", "locales", "fr.json"),
    ]
    def_rel = os.path.join("www", "rstudio", "deferredjs", gwt_hash)
    def_full = os.path.join(app_dir, def_rel)
    if os.path.isdir(def_full):
        for f in sorted(os.listdir(def_full)):
            if f.endswith(".cache.js") or f.endswith(".cache.js.gz"):
                rels.append(os.path.join(def_rel, f))
    return rels


def ensure_clean_backup(app_dir, gwt_hash):
    """Ensure a clean unpatched backup exists at <app_dir>/.rstudio_zh_backup."""
    backup_dir = os.path.join(app_dir, ".rstudio_zh_backup")
    local_clean = os.path.join(REPO_DIR, "backup", "clean_baseline")
    marker = os.path.join(backup_dir, ".backup_complete")

    if os.path.exists(marker):
        return backup_dir

    os.makedirs(backup_dir, exist_ok=True)
    rels = get_target_rel_paths(app_dir, gwt_hash)

    # Check if local_clean exists (e.g. developer workspace) or if app_dir is currently unpatched
    nocache_app = open(os.path.join(app_dir, "www", "rstudio", "rstudio.nocache.js"), "r", encoding="utf-8").read()
    is_already_patched = "p.__zh=" in nocache_app

    source_root = local_clean if (is_already_patched and os.path.isdir(local_clean)) else app_dir
    if is_already_patched and source_root == app_dir:
        raise RuntimeError(
            "RStudio files appear to be patched already, and no backup was found in .rstudio_zh_backup."
        )

    for rel in rels:
        src = os.path.join(source_root, rel)
        dst = os.path.join(backup_dir, rel)
        if os.path.exists(src):
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copy2(src, dst)

    open(marker, "w", encoding="utf-8").write(gwt_hash)
    print(f"[Backup] Saved clean original files to: {backup_dir}")
    return backup_dir


def encode_js_single_quoted(s):
    out = ["'"]
    for ch in s:
        code = ord(ch)
        if ch == "\\":
            out.append("\\\\")
        elif ch == "'":
            out.append("\\'")
        elif ch == "\n":
            out.append("\\n")
        elif ch == "\r":
            out.append("\\r")
        elif ch == "\t":
            out.append("\\t")
        elif code < 32 or code in (0x2028, 0x2029):
            out.append(f"\\u{code:04x}")
        else:
            out.append(ch)
    out.append("'")
    return "".join(out)


def template_to_js_expr(zh_str, args_str, sym_key):
    if sym_key.endswith("::kUserDictionaryWordsLabel"):
        return "a+(''+b)+" + encode_js_single_quoted(" 个词")
    if sym_key.endswith("::setMoreCommandsText"):
        return encode_js_single_quoted("加载更多 ") + "+TId(a)+" + encode_js_single_quoted(" 条记录")
    arg_list = [x.strip() for x in args_str.split(",") if x.strip()] if args_str else []
    if not arg_list:
        return encode_js_single_quoted(zh_str)
    parts = re.split(r"(\{\d+\})", zh_str)
    tokens = []
    for p in parts:
        if not p:
            continue
        m = re.match(r"^\{(\d+)\}$", p)
        if m:
            idx = int(m.group(1))
            if idx < len(arg_list):
                if not tokens:
                    tokens.append("''")
                tokens.append(arg_list[idx])
            else:
                tokens.append(encode_js_single_quoted(p))
        else:
            tokens.append(encode_js_single_quoted(p))
    return "+".join(tokens) if tokens else "''"


def decode_js_str(s):
    inner = s[1:-1]
    def repl(m):
        esc = m.group(1)
        if esc == "n": return "\n"
        if esc == "r": return "\r"
        if esc == "t": return "\t"
        if esc == "\\": return "\\"
        if esc == "'": return "'"
        if esc == '"': return '"'
        if esc == "/": return "/"
        if esc.startswith("x"): return chr(int(esc[1:], 16))
        if esc.startswith("u"): return chr(int(esc[1:], 16))
        return esc
    return re.sub(r"\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)", repl, inner)


def load_symbol_map(app_dir, gwt_hash):
    """Parse <gwt_hash>.symbolMap.gz to map (base_class, member) -> js_name."""
    sym_path = os.path.join(app_dir, "www-symbolmaps", f"{gwt_hash}.symbolMap.gz")
    if not os.path.exists(sym_path):
        return None
    js_to_sym = {}
    cldr_js = {}
    with gzip.open(sym_path, "rt", encoding="utf-8") as f:
        for line in f:
            if line.startswith("#"):
                continue
            parts = line.strip().split(",")
            if len(parts) < 5:
                continue
            js_name, jni, class_name, member_name = parts[0], parts[1], parts[2], parts[3]
            if not member_name or member_name == class_name.split(".")[-1] or member_name.startswith("$"):
                continue
            if class_name.endswith("_en"):
                base = class_name[:-3]
                js_to_sym[js_name] = f"{base}::{member_name}"
            if class_name in (
                "com.google.gwt.i18n.shared.DefaultDateTimeFormatInfo",
                "com.google.gwt.i18n.client.DefaultDateTimeFormatInfo",
                "com.google.gwt.i18n.client.impl.cldr.DateTimeFormatInfoImpl_en",
            ):
                cldr_js[member_name] = js_name
    return js_to_sym, cldr_js


def ensure_rstudio_closed():
    if platform.system() == "Windows":
        import subprocess
        for proc in ("rstudio.exe", "rsession-utf8.exe", "rsession.exe"):
            subprocess.run(["taskkill", "/F", "/IM", proc, "/T"], capture_output=True)


def clear_caches_and_set_pref(lang="zh_CN"):
    """Clear RStudio's Chromium caches, repair state if needed, and set ui_language in rstudio-prefs.json."""
    local_app_dir = ""
    cache_dirs = []
    if platform.system() == "Windows":
        appdata = os.environ.get("APPDATA", "")
        localappdata = os.environ.get("LOCALAPPDATA", "")
        config_dir = os.path.join(appdata, "RStudio") if appdata else ""
        local_app_dir = os.path.join(localappdata, "RStudio") if localappdata else ""
        if appdata:
            cache_dirs = [
                os.path.join(appdata, "RStudio", "web-cache"),
                os.path.join(appdata, "RStudio", "Cache"),
                os.path.join(appdata, "RStudio", "Code Cache"),
                os.path.join(appdata, "RStudio", "Network", "Cookies"),
                os.path.join(appdata, "RStudio", "Network", "Cookies-journal"),
            ]
    elif platform.system() == "Darwin":
        config_dir = os.path.expanduser("~/.config/rstudio")
        local_app_dir = os.path.expanduser("~/.local/share/rstudio")
        app_sup = os.path.expanduser("~/Library/Application Support/RStudio")
        cache_dirs = [
            os.path.join(app_sup, "web-cache"),
            os.path.join(app_sup, "Cache"),
            os.path.join(app_sup, "Code Cache"),
        ]
    else:
        config_dir = os.path.expanduser("~/.config/rstudio")
        local_app_dir = os.path.expanduser("~/.local/share/rstudio")
        cache_dirs = [
            os.path.join(local_app_dir, "web-cache"),
            os.path.join(config_dir, "Cache"),
            os.path.join(config_dir, "Code Cache"),
        ]

    for cd in cache_dirs:
        if cd and os.path.exists(cd):
            try:
                if os.path.isdir(cd):
                    shutil.rmtree(cd, ignore_errors=True)
                else:
                    os.remove(cd)
                print(f"[Cache] Cleared RStudio cache: {cd}")
            except Exception:
                pass

    if local_app_dir:
        scm_path = os.path.join(local_app_dir, "client-state", "source-column-manager.persistent")
        if os.path.exists(scm_path):
            try:
                raw = open(scm_path, "r", encoding="utf-8").read()
                if "源代码" in raw:
                    fixed = {"column-info": {"names": ["Source"], "activeColumn": "Source"}}
                    with open(scm_path, "w", encoding="utf-8") as f:
                        json.dump(fixed, f, indent=4)
                    print("[State] Repaired source-column-manager.persistent -> 'Source'")
            except Exception:
                pass

    if config_dir and lang:
        prefs_path = os.path.join(config_dir, "rstudio-prefs.json")
        prefs = {}
        if os.path.exists(prefs_path):
            try:
                prefs = json.load(open(prefs_path, "r", encoding="utf-8"))
            except Exception:
                pass
        prefs["ui_language"] = lang
        os.makedirs(config_dir, exist_ok=True)
        with open(prefs_path, "w", encoding="utf-8") as f:
            json.dump(prefs, f, ensure_ascii=False, indent=4)
        print(f"[Prefs] Set ui_language = '{lang}' in {prefs_path}")


def cmd_install(app_dir):
    ensure_rstudio_closed()
    gwt_hash = detect_gwt_hash(app_dir)
    print(f"[Info] Found RStudio at: {app_dir}")
    print(f"[Info] Active GWT Permutation Hash: {gwt_hash}")

    backup_dir = ensure_clean_backup(app_dir, gwt_hash)
    by_symbol = json.load(open(os.path.join(DICT_DIR, "gwt_zh_CN_by_symbol.json"), "r", encoding="utf-8"))

    sym_res = load_symbol_map(app_dir, gwt_hash)
    if not sym_res:
        raise RuntimeError(f"SymbolMap not found in {app_dir}/www-symbolmaps/{gwt_hash}.symbolMap.gz")
    js_to_sym, cldr_js = sym_res

    # 1. Patch user-prefs-schema.json
    schema_src = os.path.join(backup_dir, "resources", "schema", "user-prefs-schema.json")
    schema_dst = os.path.join(app_dir, "resources", "schema", "user-prefs-schema.json")
    schema_data = json.load(open(schema_src, "r", encoding="utf-8"))
    schema_data["properties"]["ui_language"]["enum"] = ["en", "fr", "zh_CN"]
    with open(schema_dst, "w", encoding="utf-8") as f:
        json.dump(schema_data, f, ensure_ascii=False, indent=4)
    print("[1/5] Patched resources/schema/user-prefs-schema.json (added 'zh_CN' to ui_language enum)")

    # 2. Patch rstudio.nocache.js
    nocache_src = os.path.join(backup_dir, "www", "rstudio", "rstudio.nocache.js")
    nocache_dst = os.path.join(app_dir, "www", "rstudio", "rstudio.nocache.js")
    nocache_txt = open(nocache_src, "r", encoding="utf-8").read()
    target_nc = "p[Jb]=c;return b||Fb"
    repl_nc = "p[Jb]=c;p.__zh=c.indexOf('zh')===0;return b||'en'"
    if target_nc not in nocache_txt:
        raise RuntimeError("Could not locate locale return statement in rstudio.nocache.js")
    nocache_txt = nocache_txt.replace("Fb='en'", "Fb='zh_CN'", 1)
    nocache_txt = nocache_txt.replace(target_nc, repl_nc, 1)
    open(nocache_dst, "w", encoding="utf-8").write(nocache_txt)
    print("[2/5] Patched www/rstudio/rstudio.nocache.js (enabled LOCALE=zh_CN detection)")

    # 3. Patch main <gwt_hash>.cache.js & .gz
    main_src = os.path.join(backup_dir, "www", "rstudio", f"{gwt_hash}.cache.js")
    main_dst = os.path.join(app_dir, "www", "rstudio", f"{gwt_hash}.cache.js")
    main_txt = open(main_src, "r", encoding="utf-8").read()

    # Dynamically find 'en' and 'fr' constant variable names used with 'ui_language'
    m_uilang = re.search(r"([A-Za-z0-9_$]+)='ui_language'", main_txt)
    m_fr = re.search(r"([A-Za-z0-9_$]+)='fr'", main_txt)
    if not m_uilang or not m_fr:
        raise RuntimeError("Could not locate 'ui_language' or 'fr' constant in main.cache.js")
    uilang_var = m_uilang.group(1)
    fr_var = m_fr.group(1)
    m_enum = re.search(rf"{re.escape(uilang_var)},[^[]*\[([A-Za-z0-9_$]+),{re.escape(fr_var)}\]", main_txt)
    if not m_enum:
        raise RuntimeError("Could not locate [en, fr] array in main.cache.js")
    en_var = m_enum.group(1)

    # Replace all [en_var, fr_var] arrays
    main_txt, enum_cnt = re.subn(
        rf"\[{re.escape(en_var)},{re.escape(fr_var)}\]",
        f"[{en_var},{fr_var},'zh_CN']",
        main_txt,
    )
    # Replace the dropdown display label array immediately preceding s=xN(...,[en_var,fr_var,'zh_CN'])
    main_txt, label_cnt = re.subn(
        rf"(\[[A-Za-z0-9_$]+\.[A-Za-z0-9_$]+\(\),[A-Za-z0-9_$]+\.[A-Za-z0-9_$]+\(\))(\]\);[A-Za-z0-9_$]+=[^;]+\[{re.escape(en_var)},{re.escape(fr_var)},'zh_CN'\])",
        r"\1,'中文 (简体)'\2",
        main_txt,
    )
    if enum_cnt == 0 or label_cnt == 0:
        raise RuntimeError(f"Failed to patch language dropdown (enum_cnt={enum_cnt}, label_cnt={label_cnt})")

    # Build CLDR DateTime overrides dynamically using symbolMap
    # Find array helper prefix xN(sN(V0,1),HKv,2,6, from ampms method
    cldr_expr_by_js = {}
    ampms_js = cldr_js.get("ampms")
    if ampms_js:
        m_arr = re.search(rf"function {re.escape(ampms_js)}\(\)\{{return ([^[]+)\['AM','PM'\]\)\}}", main_txt)
        if m_arr:
            arr_prefix = m_arr.group(1)
            cldr_arrays = {
                "ampms": "['上午','下午']",
                "monthsFull": "['一月','二月','三月','四月','五月','六月','七月','八月','九月','十月','十一月','十二月']",
                "monthsShort": "['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月']",
                "quartersFull": "['第一季度','第二季度','第三季度','第四季度']",
                "weekdaysFull": "['星期日','星期一','星期二','星期三','星期四','星期五','星期六']",
                "weekdaysNarrow": "['日','一','二','三','四','五','六']",
                "weekdaysShort": "['周日','周一','周二','周三','周四','周五','周六']",
            }
            for m_name, arr_str in cldr_arrays.items():
                if m_name in cldr_js:
                    cldr_expr_by_js[cldr_js[m_name]] = f"{arr_prefix}{arr_str})"

    cldr_formats = {
        "dateFormatFull": "'y年M月d日EEEE'",
        "dateFormatLong": "'y年M月d日'",
        "dateFormatMedium": "'y年M月d日'",
        "dateFormatShort": "'yy/M/d'",
        "dateTimeFull": "b+' '+a",
        "dateTimeLong": "b+' '+a",
        "formatMonthFullWeekdayDay": "'M月d日EEEE'",
        "formatYearMonthAbbrev": "'y年M月'",
        "formatYearMonthAbbrevDay": "'y年M月d日'",
        "formatYearMonthFull": "'y年M月'",
        "formatYearMonthFullDay": "'y年M月d日'",
        "formatYearMonthWeekdayDay": "'y年M月d日EEE'",
    }
    for m_name, fmt_expr in cldr_formats.items():
        if m_name in cldr_js:
            cldr_expr_by_js[cldr_js[m_name]] = fmt_expr

    func_pattern = re.compile(r"(_.[A-Za-z0-9_$]+=function\s+([A-Za-z0-9_$]+)\(([^)]*)\)\{return )([^\n}]*)(\})")
    patched_main = 0

    def repl_func(m):
        nonlocal patched_main
        prefix, js_name, args, en_expr, suffix = m.group(1), m.group(2), m.group(3), m.group(4), m.group(5)
        if js_name in cldr_expr_by_js:
            patched_main += 1
            return f"{prefix}$wnd.__zh?{cldr_expr_by_js[js_name]}:{en_expr}{suffix}"
        sym_key = js_to_sym.get(js_name)
        if sym_key and sym_key in by_symbol:
            zh_str = by_symbol[sym_key].get("zh_CN", "")
            if zh_str:
                zh_expr = template_to_js_expr(zh_str, args, sym_key)
                patched_main += 1
                return f"{prefix}$wnd.__zh?{zh_expr}:{en_expr}{suffix}"
        return m.group(0)

    main_txt = func_pattern.sub(repl_func, main_txt)
    open(main_dst, "w", encoding="utf-8").write(main_txt)
    if os.path.exists(main_dst + ".gz"):
        with gzip.open(main_dst + ".gz", "wb", compresslevel=6) as gz_f:
            gz_f.write(main_txt.encode("utf-8"))
    print(f"[3/5] Patched {gwt_hash}.cache.js ({patched_main} methods) and updated .gz")

    # 4. Patch deferredjs chunks & .gz
    def_backup_dir = os.path.join(backup_dir, "www", "rstudio", "deferredjs", gwt_hash)
    def_app_dir = os.path.join(app_dir, "www", "rstudio", "deferredjs", gwt_hash)
    patched_def = 0
    if os.path.isdir(def_backup_dir):
        for fname in sorted(os.listdir(def_backup_dir)):
            if not fname.endswith(".cache.js"):
                continue
            src_p = os.path.join(def_backup_dir, fname)
            dst_p = os.path.join(def_app_dir, fname)
            raw = open(src_p, "r", encoding="utf-8").read().strip()
            call_prefix, rest = raw.split("(", 1)
            outer_lit = rest.rsplit(")", 1)[0]
            inner_js = decode_js_str(outer_lit)

            def repl_def(m):
                nonlocal patched_def
                prefix, js_name, args, en_expr, suffix = m.group(1), m.group(2), m.group(3), m.group(4), m.group(5)
                sym_key = js_to_sym.get(js_name)
                if sym_key and sym_key in by_symbol:
                    zh_str = by_symbol[sym_key].get("zh_CN", "")
                    if zh_str:
                        zh_expr = template_to_js_expr(zh_str, args, sym_key)
                        patched_def += 1
                        return f"{prefix}$wnd.__zh?{zh_expr}:{en_expr}{suffix}"
                return m.group(0)

            inner_js = func_pattern.sub(repl_def, inner_js)
            new_raw = f"{call_prefix}({json.dumps(inner_js, ensure_ascii=True)})"
            open(dst_p, "w", encoding="utf-8").write(new_raw)
            if os.path.exists(dst_p + ".gz"):
                with gzip.open(dst_p + ".gz", "wb", compresslevel=6) as gz_f:
                    gz_f.write(new_raw.encode("utf-8"))
    print(f"[4/5] Patched deferredjs chunks ({patched_def} methods) and updated .gz files")

    # 5. Patch Electron main & renderer webpack bundles
    elec_zh = json.load(open(os.path.join(DICT_DIR, "electron_zh_CN.json"), "r", encoding="utf-8"))
    elec_fr = json.load(open(os.path.join(DICT_DIR, "electron_fr.json"), "r", encoding="utf-8"))
    elec_zh_inline = json.dumps(elec_zh, ensure_ascii=False)

    for sub in ("main", "renderer"):
        loc_dir = os.path.join(app_dir, ".webpack", sub, "assets", "locales")
        if os.path.isdir(loc_dir):
            with open(os.path.join(loc_dir, "fr.json"), "w", encoding="utf-8") as f:
                json.dump(elec_fr, f, ensure_ascii=False, indent=2)
            with open(os.path.join(loc_dir, "zh_CN.json"), "w", encoding="utf-8") as f:
                json.dump(elec_zh, f, ensure_ascii=False, indent=2)

    wmain_src = os.path.join(backup_dir, ".webpack", "main", "index.js")
    wmain_dst = os.path.join(app_dir, ".webpack", "main", "index.js")
    wmain_txt = open(wmain_src, "r", encoding="utf-8").read()
    wmain_txt = re.sub(
        r'resources:\{en:\{translation:([a-zA-Z0-9_$]+)\},fr:\{translation:([a-zA-Z0-9_$]+)\}\},fallbackLng:"en"',
        lambda m: f'resources:{{en:{{translation:{m.group(1)}}},fr:{{translation:{m.group(2)}}},zh_CN:{{translation:{elec_zh_inline}}}}},fallbackLng:"en"',
        wmain_txt,
        count=1,
    )
    wmain_txt = wmain_txt.replace(
        '"&Tools"===e?this.lastWasTools=!0:"Dia&gnostics"===e&&(this.lastWasDiagnostics=!0)',
        '("&Tools"===e||"工具(&T)"===e)?this.lastWasTools=!0:("Dia&gnostics"===e||"诊断(&G)"===e)&&(this.lastWasDiagnostics=!0)',
    )
    wmain_txt = wmain_txt.replace(
        '0===t.length?await r({name:"LOCALE",value:"en"},e)',
        '0===t.length?await r({name:"LOCALE",value:"zh_CN"},e)',
    )
    wmain_txt = wmain_txt.replace(
        'e(t,"File"),e(t,"Edit"),e(t,"Code"),e(t,"View"),e(t,"Plots"),e(t,"Session"),e(t,"Build"),e(t,"Debug"),e(t,"Profile"),e(t,"Tools"),"darwin"===process.platform&&e(t,"Window"),e(t,"Help")',
        'e(t,"文件(&F)"),e(t,"编辑(&E)"),e(t,"代码(&C)"),e(t,"视图(&V)"),e(t,"绘图(&P)"),e(t,"会话(&S)"),e(t,"构建(&B)"),e(t,"调试(&D)"),e(t,"性能分析(&P)"),e(t,"工具(&T)"),"darwin"===process.platform&&e(t,"窗口(&W)"),e(t,"帮助(&H)")',
    )
    open(wmain_dst, "w", encoding="utf-8").write(wmain_txt)

    for w in ("choose_r", "connect_window", "error_window", "loading_window"):
        w_src = os.path.join(backup_dir, ".webpack", "renderer", w, "index.js")
        w_dst = os.path.join(app_dir, ".webpack", "renderer", w, "index.js")
        if os.path.exists(w_src):
            w_txt = open(w_src, "r", encoding="utf-8").read()
            w_txt = re.sub(
                r'resources:\{en:\{translation:([a-zA-Z0-9_$]+)\},fr:\{translation:([a-zA-Z0-9_$]+)\}\},fallbackLng:"en"',
                lambda m: f'resources:{{en:{{translation:{m.group(1)}}},fr:{{translation:{m.group(2)}}},zh_CN:{{translation:{elec_zh_inline}}}}},fallbackLng:"en"',
                w_txt,
                count=1,
            )
            open(w_dst, "w", encoding="utf-8").write(w_txt)
    print("[5/5] Patched Electron main and renderer bundles")

    clear_caches_and_set_pref("zh_CN")
    print("\n[SUCCESS] RStudio Simplified Chinese (zh_CN) localization installed successfully!")


def cmd_restore(app_dir):
    ensure_rstudio_closed()
    print(f"[Info] Found RStudio at: {app_dir}")
    backup_dir = os.path.join(app_dir, ".rstudio_zh_backup")
    local_clean = os.path.join(REPO_DIR, "backup", "clean_baseline")
    src_root = backup_dir if os.path.isdir(backup_dir) else (local_clean if os.path.isdir(local_clean) else None)
    if not src_root:
        raise RuntimeError("No backup found in .rstudio_zh_backup or backup/clean_baseline.")

    count = 0
    for root, dirs, files in os.walk(src_root):
        for f in files:
            if f == ".backup_complete":
                continue
            src = os.path.join(root, f)
            rel = os.path.relpath(src, src_root)
            dst = os.path.join(app_dir, rel)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copy2(src, dst)
            count += 1

    clear_caches_and_set_pref("en")
    print(f"\n[SUCCESS] Restored {count} original files to {app_dir} and reset language to 'en'.")


def cmd_status(app_dir):
    gwt_hash = detect_gwt_hash(app_dir)
    nocache_p = os.path.join(app_dir, "www", "rstudio", "rstudio.nocache.js")
    is_patched = "p.__zh=" in open(nocache_p, "r", encoding="utf-8").read()
    backup_dir = os.path.join(app_dir, ".rstudio_zh_backup")
    has_backup = os.path.exists(os.path.join(backup_dir, ".backup_complete"))
    print(f"RStudio App Directory : {app_dir}")
    print(f"GWT Permutation Hash  : {gwt_hash}")
    print(f"Chinese Patch Status  : {'INSTALLED (已安装中文补丁)' if is_patched else 'ORIGINAL (未安装/官方原版)'}")
    print(f"Local Backup Present  : {'YES' if has_backup else 'NO'}")


def main():
    parser = argparse.ArgumentParser(description="RStudio Desktop Simplified Chinese (zh_CN) Localization Tool")
    parser.add_argument("action", nargs="?", choices=["install", "restore", "status"], help="Action to perform")
    parser.add_argument("--dir", help="Path to RStudio installation directory (auto-detected if omitted)")
    args = parser.parse_args()

    app_dir = find_rstudio_app_dir(args.dir)
    if not app_dir:
        print("[ERROR] Could not auto-detect RStudio installation directory.")
        print('Please specify it manually, e.g.: python rstudio_zh.py install --dir "D:\\RStudio"')
        sys.exit(1)

    action = args.action
    if not action:
        cmd_status(app_dir)
        print("\n请选择操作 / Select an action:")
        print("  [1] 一键安装中文语言选项及汉化包 (Install Chinese Localization)")
        print("  [2] 一键还原官方原版 (Restore Original RStudio)")
        print("  [Q] 退出 (Quit)")
        choice = input("\n请输入选项 (1/2/Q): ").strip().lower()
        if choice == "1":
            action = "install"
        elif choice == "2":
            action = "restore"
        else:
            return

    if action == "install":
        cmd_install(app_dir)
    elif action == "restore":
        cmd_restore(app_dir)
    elif action == "status":
        cmd_status(app_dir)


if __name__ == "__main__":
    main()
