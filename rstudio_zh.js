#!/usr/bin/env node
/**
 * RStudio Desktop Simplified Chinese (zh_CN) Localization Tool (Zero-Dependency Node.js Edition)
 * ==============================================================================================
 * Runs directly using RStudio's built-in Node.js runtime (`resources/app/bin/node/node.exe`).
 * Users do NOT need Python or external Node.js installed!
 *
 * Usage:
 *   node rstudio_zh.js install [--dir "D:\\RStudio"]
 *   node rstudio_zh.js restore [--dir "D:\\RStudio"]
 *   node rstudio_zh.js status  [--dir "D:\\RStudio"]
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const os = require('os');
const child_process = require('child_process');
const readline = require('readline');

const REPO_DIR = __dirname;
const DICT_DIR = path.join(REPO_DIR, 'dictionaries');

function findRStudioAppDir(customDir) {
  const candidates = [];
  if (customDir) candidates.push(customDir);
  if (process.env.RSTUDIO_DIR) candidates.push(process.env.RSTUDIO_DIR);

  // If executed via RStudio's own bundled node.exe (<RStudio>/resources/app/bin/node/node.exe),
  // process.execPath is right inside <RStudio>/resources/app/bin/node/!
  const execAppCandidate = path.resolve(path.dirname(process.execPath), '..', '..');
  candidates.push(execAppCandidate);

  if (process.platform === 'win32') {
    const regKeys = [
      'HKLM\\SOFTWARE\\RStudio',
      'HKCU\\SOFTWARE\\RStudio',
      'HKLM\\SOFTWARE\\WOW6432Node\\RStudio',
      'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\RStudio',
    ];
    for (const key of regKeys) {
      try {
        const out = child_process.execSync(`reg query "${key}"`, { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' });
        for (const line of out.split(/\r?\n/)) {
          const m = line.match(/(?:Path|InstallLocation|UninstallString)\s+REG_\w+\s+(.+)$/i);
          if (m && m[1]) {
            let v = m[1].trim().replace(/^"+|"+$/g, '');
            if (v.toLowerCase().endsWith('.exe')) v = path.dirname(v);
            candidates.push(v);
          }
        }
      } catch (_) {}
    }
    const localAppData = process.env.LOCALAPPDATA || '';
    const progFiles = process.env.ProgramFiles || 'C:\\Program Files';
    const progFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    candidates.push(
      path.join(progFiles, 'RStudio'),
      localAppData ? path.join(localAppData, 'Programs', 'RStudio') : '',
      'D:\\RStudio',
      'C:\\RStudio',
      'E:\\RStudio',
      'F:\\RStudio',
      path.join(progFilesX86, 'RStudio')
    );
  } else if (process.platform === 'darwin') {
    candidates.push(
      '/Applications/RStudio.app/Contents/Resources/app',
      path.join(os.homedir(), 'Applications/RStudio.app/Contents/Resources/app')
    );
  } else {
    candidates.push(
      '/usr/lib/rstudio/resources/app',
      '/usr/lib/rstudio',
      '/opt/rstudio/resources/app',
      '/opt/rstudio'
    );
  }

  for (const c of candidates) {
    if (!c) continue;
    const abs = path.resolve(c);
    const subPaths = [
      abs,
      path.join(abs, 'resources', 'app'),
      path.join(abs, 'Contents', 'Resources', 'app'),
    ];
    for (const p of subPaths) {
      if (fs.existsSync(path.join(p, 'www', 'rstudio', 'rstudio.nocache.js'))) {
        return p;
      }
    }
  }
  return null;
}

function detectGwtHash(appDir) {
  const nocache = path.join(appDir, 'www', 'rstudio', 'rstudio.nocache.js');
  const txt = fs.readFileSync(nocache, 'utf8');
  const m = txt.match(/'([0-9A-F]{32})'/);
  if (!m) throw new Error(`Could not find 32-char GWT hash in ${nocache}`);
  return m[1];
}

function getTargetRelPaths(appDir, gwtHash) {
  const rels = [
    path.join('resources', 'schema', 'user-prefs-schema.json'),
    path.join('www', 'rstudio', 'rstudio.nocache.js'),
    path.join('www', 'rstudio', `${gwtHash}.cache.js`),
    path.join('www', 'rstudio', `${gwtHash}.cache.js.gz`),
    path.join('.webpack', 'main', 'index.js'),
    path.join('.webpack', 'main', 'assets', 'locales', 'en.json'),
    path.join('.webpack', 'main', 'assets', 'locales', 'fr.json'),
    path.join('.webpack', 'renderer', 'choose_r', 'index.js'),
    path.join('.webpack', 'renderer', 'connect_window', 'index.js'),
    path.join('.webpack', 'renderer', 'error_window', 'index.js'),
    path.join('.webpack', 'renderer', 'loading_window', 'index.js'),
    path.join('.webpack', 'renderer', 'assets', 'locales', 'en.json'),
    path.join('.webpack', 'renderer', 'assets', 'locales', 'fr.json'),
  ];
  const defRel = path.join('www', 'rstudio', 'deferredjs', gwtHash);
  const defFull = path.join(appDir, defRel);
  if (fs.existsSync(defFull)) {
    for (const f of fs.readdirSync(defFull).sort()) {
      if (f.endsWith('.cache.js') || f.endsWith('.cache.js.gz')) {
        rels.push(path.join(defRel, f));
      }
    }
  }
  return rels;
}

function ensureCleanBackup(appDir, gwtHash) {
  const backupDir = path.join(appDir, '.rstudio_zh_backup');
  const localClean = path.join(REPO_DIR, 'backup', 'clean_baseline');
  const marker = path.join(backupDir, '.backup_complete');

  if (fs.existsSync(marker)) return backupDir;

  fs.mkdirSync(backupDir, { recursive: true });
  const rels = getTargetRelPaths(appDir, gwtHash);
  const nocacheApp = fs.readFileSync(path.join(appDir, 'www', 'rstudio', 'rstudio.nocache.js'), 'utf8');
  const isAlreadyPatched = nocacheApp.includes('p.__zh=');

  const sourceRoot = (isAlreadyPatched && fs.existsSync(localClean)) ? localClean : appDir;
  if (isAlreadyPatched && sourceRoot === appDir) {
    throw new Error('RStudio files appear to be patched already, and no backup was found in .rstudio_zh_backup.');
  }

  for (const rel of rels) {
    const src = path.join(sourceRoot, rel);
    const dst = path.join(backupDir, rel);
    if (fs.existsSync(src)) {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
    }
  }
  fs.writeFileSync(marker, gwtHash, 'utf8');
  console.log(`[Backup] Saved clean original files to: ${backupDir}`);
  return backupDir;
}

function encodeJsSingleQuoted(s) {
  let out = "'";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const code = s.charCodeAt(i);
    if (ch === '\\') out += '\\\\';
    else if (ch === "'") out += "\\'";
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (code < 32 || code === 0x2028 || code === 0x2029) {
      out += '\\u' + code.toString(16).padStart(4, '0');
    } else {
      out += ch;
    }
  }
  out += "'";
  return out;
}

function templateToJsExpr(zhStr, argsStr, symKey) {
  if (symKey.endsWith('::kUserDictionaryWordsLabel')) {
    return "a+(''+b)+" + encodeJsSingleQuoted(' 个词');
  }
  if (symKey.endsWith('::setMoreCommandsText')) {
    return encodeJsSingleQuoted('加载更多 ') + '+TId(a)+' + encodeJsSingleQuoted(' 条记录');
  }
  const argList = argsStr ? argsStr.split(',').map(x => x.trim()).filter(Boolean) : [];
  if (argList.length === 0) {
    return encodeJsSingleQuoted(zhStr);
  }
  const parts = zhStr.split(/(\{\d+\})/);
  const tokens = [];
  for (const p of parts) {
    if (!p) continue;
    const m = p.match(/^\{(\d+)\}$/);
    if (m) {
      const idx = parseInt(m[1], 10);
      if (idx < argList.length) {
        if (tokens.length === 0) tokens.push("''");
        tokens.push(argList[idx]);
      } else {
        tokens.push(encodeJsSingleQuoted(p));
      }
    } else {
      tokens.push(encodeJsSingleQuoted(p));
    }
  }
  return tokens.length > 0 ? tokens.join('+') : "''";
}

function decodeJsStr(s) {
  const inner = s.slice(1, -1);
  return inner.replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/g, (_, esc) => {
    if (esc === 'n') return '\n';
    if (esc === 'r') return '\r';
    if (esc === 't') return '\t';
    if (esc === '\\') return '\\';
    if (esc === "'") return "'";
    if (esc === '"') return '"';
    if (esc === '/') return '/';
    if (esc.startsWith('x') || esc.startsWith('u')) {
      return String.fromCharCode(parseInt(esc.slice(1), 16));
    }
    return esc;
  });
}

function encodeAsciiJsonStr(s) {
  return JSON.stringify(s).replace(/[\u007f-\uffff]/g, ch => {
    return '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0');
  });
}

function loadSymbolMap(appDir, gwtHash) {
  const symPath = path.join(appDir, 'www-symbolmaps', `${gwtHash}.symbolMap.gz`);
  if (!fs.existsSync(symPath)) return null;
  const content = zlib.gunzipSync(fs.readFileSync(symPath)).toString('utf8');
  const jsToSym = new Map();
  const cldrJs = new Map();

  for (const line of content.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(',');
    if (parts.length < 5) continue;
    const [jsName, , className, memberName] = parts;
    const shortCls = className.slice(className.lastIndexOf('.') + 1);
    if (!memberName || memberName === shortCls || memberName.startsWith('$')) continue;
    if (className.endsWith('_en')) {
      const base = className.slice(0, -3);
      jsToSym.set(jsName, `${base}::${memberName}`);
    }
    if (
      className === 'com.google.gwt.i18n.shared.DefaultDateTimeFormatInfo' ||
      className === 'com.google.gwt.i18n.client.DefaultDateTimeFormatInfo' ||
      className === 'com.google.gwt.i18n.client.impl.cldr.DateTimeFormatInfoImpl_en'
    ) {
      cldrJs.set(memberName, jsName);
    }
  }
  return { jsToSym, cldrJs };
}

function ensureRStudioClosed() {
  if (process.platform === 'win32') {
    for (const proc of ['rstudio.exe', 'rsession-utf8.exe', 'rsession.exe']) {
      try {
        child_process.execSync(`taskkill /F /IM ${proc} /T`, { stdio: 'ignore' });
      } catch (_) {}
    }
  }
}

function clearCachesAndSetPref(lang) {
  let configDir = '';
  let localAppDir = '';
  const cacheDirs = [];
  if (process.platform === 'win32') {
    const appdata = process.env.APPDATA || '';
    const localappdata = process.env.LOCALAPPDATA || '';
    if (appdata) {
      configDir = path.join(appdata, 'RStudio');
      cacheDirs.push(
        path.join(appdata, 'RStudio', 'web-cache'),
        path.join(appdata, 'RStudio', 'Cache'),
        path.join(appdata, 'RStudio', 'Code Cache'),
        path.join(appdata, 'RStudio', 'Network', 'Cookies'),
        path.join(appdata, 'RStudio', 'Network', 'Cookies-journal')
      );
    }
    if (localappdata) {
      localAppDir = path.join(localappdata, 'RStudio');
    }
  } else if (process.platform === 'darwin') {
    configDir = path.join(os.homedir(), '.config', 'rstudio');
    const appSup = path.join(os.homedir(), 'Library', 'Application Support', 'RStudio');
    localAppDir = path.join(os.homedir(), '.local', 'share', 'rstudio');
    cacheDirs.push(
      path.join(appSup, 'web-cache'),
      path.join(appSup, 'Cache'),
      path.join(appSup, 'Code Cache')
    );
  } else {
    configDir = path.join(os.homedir(), '.config', 'rstudio');
    localAppDir = path.join(os.homedir(), '.local', 'share', 'rstudio');
    cacheDirs.push(
      path.join(localAppDir, 'web-cache'),
      path.join(configDir, 'Cache'),
      path.join(configDir, 'Code Cache')
    );
  }

  for (const cd of cacheDirs) {
    if (cd && fs.existsSync(cd)) {
      try {
        fs.rmSync(cd, { recursive: true, force: true });
        console.log(`[Cache] Cleared RStudio cache: ${cd}`);
      } catch (_) {}
    }
  }

  // Ensure source-column-manager.persistent uses internal quadrant ID 'Source'
  if (localAppDir) {
    const scmPath = path.join(localAppDir, 'client-state', 'source-column-manager.persistent');
    if (fs.existsSync(scmPath)) {
      try {
        const raw = fs.readFileSync(scmPath, 'utf8');
        if (raw.includes('源代码')) {
          const fixed = { 'column-info': { names: ['Source'], activeColumn: 'Source' } };
          fs.writeFileSync(scmPath, JSON.stringify(fixed, null, 4), 'utf8');
          console.log(`[State] Repaired source-column-manager.persistent -> 'Source'`);
        }
      } catch (_) {}
    }
  }

  if (configDir && lang) {
    const prefsPath = path.join(configDir, 'rstudio-prefs.json');
    let prefs = {};
    if (fs.existsSync(prefsPath)) {
      try {
        prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf8'));
      } catch (_) {}
    }
    prefs.ui_language = lang;
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(prefsPath, JSON.stringify(prefs, null, 4), 'utf8');
    console.log(`[Prefs] Set ui_language = '${lang}' in ${prefsPath}`);
  }
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cmdInstall(appDir) {
  console.log('====================================================================');
  console.log('  RStudio Desktop 简体中文 (zh_CN) 选项及全量汉化一键安装工具');
  console.log('====================================================================');
  ensureRStudioClosed();
  const gwtHash = detectGwtHash(appDir);
  console.log(`[Info] Found RStudio at: ${appDir}`);
  console.log(`[Info] Active GWT Permutation Hash: ${gwtHash}`);

  const backupDir = ensureCleanBackup(appDir, gwtHash);
  const bySymbol = JSON.parse(fs.readFileSync(path.join(DICT_DIR, 'gwt_zh_CN_by_symbol.json'), 'utf8'));

  const symRes = loadSymbolMap(appDir, gwtHash);
  if (!symRes) {
    throw new Error(`SymbolMap not found in ${appDir}/www-symbolmaps/${gwtHash}.symbolMap.gz`);
  }
  const { jsToSym, cldrJs } = symRes;

  // 1. Patch user-prefs-schema.json
  const schemaSrc = path.join(backupDir, 'resources', 'schema', 'user-prefs-schema.json');
  const schemaDst = path.join(appDir, 'resources', 'schema', 'user-prefs-schema.json');
  const schemaData = JSON.parse(fs.readFileSync(schemaSrc, 'utf8'));
  schemaData.properties.ui_language.enum = ['en', 'fr', 'zh_CN'];
  fs.writeFileSync(schemaDst, JSON.stringify(schemaData, null, 4), 'utf8');
  console.log("[1/5] Patched resources/schema/user-prefs-schema.json (added 'zh_CN' to ui_language enum)");

  // 2. Patch rstudio.nocache.js
  const nocacheSrc = path.join(backupDir, 'www', 'rstudio', 'rstudio.nocache.js');
  const nocacheDst = path.join(appDir, 'www', 'rstudio', 'rstudio.nocache.js');
  let nocacheTxt = fs.readFileSync(nocacheSrc, 'utf8');
  const targetNc = 'p[Jb]=c;return b||Fb';
  const replNc = "p[Jb]=c;p.__zh=c.indexOf('zh')===0;return b||Fb";
  if (!nocacheTxt.includes(targetNc)) {
    throw new Error('Could not locate locale return statement in rstudio.nocache.js');
  }
  nocacheTxt = nocacheTxt.replace('if(!b){b=p[Jb]}', 'if(!b){b=p[Jb]||"zh_CN";q.cookie="LOCALE="+b+";path=/"}');
  nocacheTxt = nocacheTxt.replace(targetNc, replNc);
  fs.writeFileSync(nocacheDst, nocacheTxt, 'utf8');
  console.log('[2/5] Patched www/rstudio/rstudio.nocache.js (enabled LOCALE=zh_CN detection)');

  // 3. Patch main <gwtHash>.cache.js & .gz
  const mainSrc = path.join(backupDir, 'www', 'rstudio', `${gwtHash}.cache.js`);
  const mainDst = path.join(appDir, 'www', 'rstudio', `${gwtHash}.cache.js`);
  let mainTxt = fs.readFileSync(mainSrc, 'utf8');

  const mUilang = mainTxt.match(/([A-Za-z0-9_$]+)='ui_language'/);
  const mFr = mainTxt.match(/([A-Za-z0-9_$]+)='fr'/);
  if (!mUilang || !mFr) {
    throw new Error("Could not locate 'ui_language' or 'fr' constant in main.cache.js");
  }
  const uilangVar = mUilang[1];
  const frVar = mFr[1];
  const mEnum = mainTxt.match(new RegExp(`${escapeRegExp(uilangVar)},[^\\[]*\\[([A-Za-z0-9_$]+),${escapeRegExp(frVar)}\\]`));
  if (!mEnum) {
    throw new Error('Could not locate [en, fr] array in main.cache.js');
  }
  const enVar = mEnum[1];

  const enumRe = new RegExp(`\\[${escapeRegExp(enVar)},${escapeRegExp(frVar)}\\]`, 'g');
  mainTxt = mainTxt.replace(enumRe, `[${enVar},${frVar},'zh_CN']`);

  const labelRe = new RegExp(
    `(\\[[A-Za-z0-9_$]+\\.[A-Za-z0-9_$]+\\(\\),[A-Za-z0-9_$]+\\.[A-Za-z0-9_$]+\\(\\))(\\]\\);[A-Za-z0-9_$]+=[^;]+\\[${escapeRegExp(enVar)},${escapeRegExp(frVar)},'zh_CN'\\])`
  );
  mainTxt = mainTxt.replace(labelRe, "$1,'中文 (简体)'$2");

  // Build CLDR DateTime overrides dynamically
  const cldrExprByJs = new Map();
  const ampmsJs = cldrJs.get('ampms');
  if (ampmsJs) {
    const mArr = mainTxt.match(new RegExp(`function ${escapeRegExp(ampmsJs)}\\(\\)\\{return ([^\\[]+)\\['AM','PM'\\]\\)\\}`));
    if (mArr) {
      const arrPrefix = mArr[1];
      const cldrArrays = {
        ampms: "['上午','下午']",
        monthsFull: "['一月','二月','三月','四月','五月','六月','七月','八月','九月','十月','十一月','十二月']",
        monthsShort: "['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月']",
        quartersFull: "['第一季度','第二季度','第三季度','第四季度']",
        weekdaysFull: "['星期日','星期一','星期二','星期三','星期四','星期五','星期六']",
        weekdaysNarrow: "['日','一','二','三','四','五','六']",
        weekdaysShort: "['周日','周一','周二','周三','周四','周五','周六']",
      };
      for (const [mName, arrStr] of Object.entries(cldrArrays)) {
        if (cldrJs.has(mName)) {
          cldrExprByJs.set(cldrJs.get(mName), `${arrPrefix}${arrStr})`);
        }
      }
    }
  }

  const cldrFormats = {
    dateFormatFull: "'y年M月d日EEEE'",
    dateFormatLong: "'y年M月d日'",
    dateFormatMedium: "'y年M月d日'",
    dateFormatShort: "'yy/M/d'",
    dateTimeFull: "b+' '+a",
    dateTimeLong: "b+' '+a",
    formatMonthFullWeekdayDay: "'M月d日EEEE'",
    formatYearMonthAbbrev: "'y年M月'",
    formatYearMonthAbbrevDay: "'y年M月d日'",
    formatYearMonthFull: "'y年M月'",
    formatYearMonthFullDay: "'y年M月d日'",
    formatYearMonthWeekdayDay: "'y年M月d日EEE'",
  };
  for (const [mName, fmtExpr] of Object.entries(cldrFormats)) {
    if (cldrJs.has(mName)) {
      cldrExprByJs.set(cldrJs.get(mName), fmtExpr);
    }
  }

  const funcPattern = /(_\.[A-Za-z0-9_$]+=function\s+([A-Za-z0-9_$]+)\(([^)]*)\)\{return )([^\n}]*)(\})/g;
  let patchedMain = 0;

  mainTxt = mainTxt.replace(funcPattern, (full, prefix, jsName, args, enExpr, suffix) => {
    if (cldrExprByJs.has(jsName)) {
      patchedMain++;
      return `${prefix}$wnd.__zh?${cldrExprByJs.get(jsName)}:${enExpr}${suffix}`;
    }
    const symKey = jsToSym.get(jsName);
    if (symKey && bySymbol[symKey] && bySymbol[symKey].zh_CN) {
      const zhExpr = templateToJsExpr(bySymbol[symKey].zh_CN, args, symKey);
      patchedMain++;
      return `${prefix}$wnd.__zh?${zhExpr}:${enExpr}${suffix}`;
    }
    return full;
  });

  fs.writeFileSync(mainDst, mainTxt, 'utf8');
  if (fs.existsSync(mainDst + '.gz')) {
    fs.writeFileSync(mainDst + '.gz', zlib.gzipSync(Buffer.from(mainTxt, 'utf8'), { level: 6 }));
  }
  console.log(`[3/5] Patched ${gwtHash}.cache.js (${patchedMain} methods) and updated .gz`);

  // 4. Patch deferredjs chunks & .gz
  const defBackupDir = path.join(backupDir, 'www', 'rstudio', 'deferredjs', gwtHash);
  const defAppDir = path.join(appDir, 'www', 'rstudio', 'deferredjs', gwtHash);
  let patchedDef = 0;
  if (fs.existsSync(defBackupDir)) {
    for (const fname of fs.readdirSync(defBackupDir).sort()) {
      if (!fname.endsWith('.cache.js')) continue;
      const srcP = path.join(defBackupDir, fname);
      const dstP = path.join(defAppDir, fname);
      const raw = fs.readFileSync(srcP, 'utf8').trim();
      const parenIdx = raw.indexOf('(');
      const lastParenIdx = raw.lastIndexOf(')');
      const callPrefix = raw.slice(0, parenIdx);
      const outerLit = raw.slice(parenIdx + 1, lastParenIdx);
      let innerJs = decodeJsStr(outerLit);

      innerJs = innerJs.replace(funcPattern, (full, prefix, jsName, args, enExpr, suffix) => {
        const symKey = jsToSym.get(jsName);
        if (symKey && bySymbol[symKey] && bySymbol[symKey].zh_CN) {
          const zhExpr = templateToJsExpr(bySymbol[symKey].zh_CN, args, symKey);
          patchedDef++;
          return `${prefix}$wnd.__zh?${zhExpr}:${enExpr}${suffix}`;
        }
        return full;
      });

      const newRaw = `${callPrefix}(${encodeAsciiJsonStr(innerJs)})`;
      fs.writeFileSync(dstP, newRaw, 'utf8');
      if (fs.existsSync(dstP + '.gz')) {
        fs.writeFileSync(dstP + '.gz', zlib.gzipSync(Buffer.from(newRaw, 'utf8'), { level: 6 }));
      }
    }
  }
  console.log(`[4/5] Patched deferredjs chunks (${patchedDef} methods) and updated .gz files`);

  // 5. Patch Electron main & renderer webpack bundles
  const elecZh = JSON.parse(fs.readFileSync(path.join(DICT_DIR, 'electron_zh_CN.json'), 'utf8'));
  const elecFr = JSON.parse(fs.readFileSync(path.join(DICT_DIR, 'electron_fr.json'), 'utf8'));
  const elecZhInline = JSON.stringify(elecZh);

  for (const sub of ['main', 'renderer']) {
    const locDir = path.join(appDir, '.webpack', sub, 'assets', 'locales');
    if (fs.existsSync(locDir)) {
      fs.writeFileSync(path.join(locDir, 'fr.json'), JSON.stringify(elecFr, null, 2), 'utf8');
      fs.writeFileSync(path.join(locDir, 'zh_CN.json'), JSON.stringify(elecZh, null, 2), 'utf8');
    }
  }

  const wmainSrc = path.join(backupDir, '.webpack', 'main', 'index.js');
  const wmainDst = path.join(appDir, '.webpack', 'main', 'index.js');
  let wmainTxt = fs.readFileSync(wmainSrc, 'utf8');
  wmainTxt = wmainTxt.replace(
    /resources:\{en:\{translation:([a-zA-Z0-9_$]+)\},fr:\{translation:([a-zA-Z0-9_$]+)\}\},fallbackLng:"en"/,
    (_, vEn, vFr) => `resources:{en:{translation:${vEn}},fr:{translation:${vFr}},zh_CN:{translation:${elecZhInline}}},fallbackLng:"en"`
  );
  wmainTxt = wmainTxt.replace(
    '"&Tools"===e?this.lastWasTools=!0:"Dia&gnostics"===e&&(this.lastWasDiagnostics=!0)',
    '("&Tools"===e||"工具(&T)"===e)?this.lastWasTools=!0:("Dia&gnostics"===e||"诊断(&G)"===e)&&(this.lastWasDiagnostics=!0)'
  );
  wmainTxt = wmainTxt.replace(
    '0===t.length?await r({name:"LOCALE",value:"en"},e)',
    '0===t.length?await r({name:"LOCALE",value:"zh_CN"},e)'
  );
  wmainTxt = wmainTxt.replace(
    'e(t,"File"),e(t,"Edit"),e(t,"Code"),e(t,"View"),e(t,"Plots"),e(t,"Session"),e(t,"Build"),e(t,"Debug"),e(t,"Profile"),e(t,"Tools"),"darwin"===process.platform&&e(t,"Window"),e(t,"Help")',
    'e(t,"文件(&F)"),e(t,"编辑(&E)"),e(t,"代码(&C)"),e(t,"视图(&V)"),e(t,"绘图(&P)"),e(t,"会话(&S)"),e(t,"构建(&B)"),e(t,"调试(&D)"),e(t,"性能分析(&P)"),e(t,"工具(&T)"),"darwin"===process.platform&&e(t,"窗口(&W)"),e(t,"帮助(&H)")'
  );
  fs.writeFileSync(wmainDst, wmainTxt, 'utf8');

  for (const w of ['choose_r', 'connect_window', 'error_window', 'loading_window']) {
    const wSrc = path.join(backupDir, '.webpack', 'renderer', w, 'index.js');
    const wDst = path.join(appDir, '.webpack', 'renderer', w, 'index.js');
    if (fs.existsSync(wSrc)) {
      let wTxt = fs.readFileSync(wSrc, 'utf8');
      wTxt = wTxt.replace(
        /resources:\{en:\{translation:([a-zA-Z0-9_$]+)\},fr:\{translation:([a-zA-Z0-9_$]+)\}\},fallbackLng:"en"/,
        (_, vEn, vFr) => `resources:{en:{translation:${vEn}},fr:{translation:${vFr}},zh_CN:{translation:${elecZhInline}}},fallbackLng:"en"`
      );
      fs.writeFileSync(wDst, wTxt, 'utf8');
    }
  }
  console.log('[5/5] Patched Electron main and renderer bundles');

  clearCachesAndSetPref('zh_CN');
  console.log('\n[SUCCESS] RStudio Simplified Chinese (zh_CN) localization installed successfully!');
}

function copyDirRecursive(srcRoot, dstRoot) {
  let count = 0;
  for (const entry of fs.readdirSync(srcRoot, { withFileTypes: true })) {
    if (entry.name === '.backup_complete') continue;
    const srcPath = path.join(srcRoot, entry.name);
    const dstPath = path.join(dstRoot, entry.name);
    if (entry.isDirectory()) {
      count += copyDirRecursive(srcPath, dstPath);
    } else {
      fs.mkdirSync(path.dirname(dstPath), { recursive: true });
      fs.copyFileSync(srcPath, dstPath);
      count++;
    }
  }
  return count;
}

function cmdRestore(appDir) {
  console.log('====================================================================');
  console.log('  RStudio Desktop 一键还原官方原版 (Restore Original)');
  console.log('====================================================================');
  ensureRStudioClosed();
  console.log(`[Info] Found RStudio at: ${appDir}`);
  const backupDir = path.join(appDir, '.rstudio_zh_backup');
  const localClean = path.join(REPO_DIR, 'backup', 'clean_baseline');
  const srcRoot = fs.existsSync(backupDir) ? backupDir : (fs.existsSync(localClean) ? localClean : null);
  if (!srcRoot) {
    throw new Error('No backup found in .rstudio_zh_backup or backup/clean_baseline.');
  }
  const count = copyDirRecursive(srcRoot, appDir);
  clearCachesAndSetPref('en');
  console.log(`\n[SUCCESS] Restored ${count} original files to ${appDir} and reset language to 'en'.`);
}

function cmdStatus(appDir) {
  const gwtHash = detectGwtHash(appDir);
  const nocacheP = path.join(appDir, 'www', 'rstudio', 'rstudio.nocache.js');
  const isPatched = fs.readFileSync(nocacheP, 'utf8').includes('p.__zh=');
  const backupDir = path.join(appDir, '.rstudio_zh_backup');
  const hasBackup = fs.existsSync(path.join(backupDir, '.backup_complete'));
  console.log(`RStudio App Directory : ${appDir}`);
  console.log(`GWT Permutation Hash  : ${gwtHash}`);
  console.log(`Chinese Patch Status  : ${isPatched ? 'INSTALLED (已安装中文补丁)' : 'ORIGINAL (未安装/官方原版)'}`);
  console.log(`Local Backup Present  : ${hasBackup ? 'YES' : 'NO'}`);
}

function main() {
  const args = process.argv.slice(2);
  let action = null;
  let customDir = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dir' && i + 1 < args.length) {
      customDir = args[++i];
    } else if (['install', 'restore', 'status'].includes(args[i])) {
      action = args[i];
    }
  }

  const appDir = findRStudioAppDir(customDir);
  if (!appDir) {
    console.error('[ERROR] 未能自动检测到 RStudio 安装目录 (Could not auto-detect RStudio directory).');
    console.error('请通过 --dir 参数指定 RStudio 安装路径，例如: --dir "D:\\RStudio"');
    process.exit(1);
  }

  if (action === 'install') {
    cmdInstall(appDir);
  } else if (action === 'restore') {
    cmdRestore(appDir);
  } else if (action === 'status') {
    cmdStatus(appDir);
  } else {
    cmdStatus(appDir);
    console.log('\n请选择操作 / Select an action:');
    console.log('  [1] 一键安装中文语言选项及汉化包 (Install Chinese Localization)');
    console.log('  [2] 一键还原官方原版 (Restore Original RStudio)');
    console.log('  [Q] 退出 (Quit)');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('\n请输入选项 (1/2/Q): ', answer => {
      rl.close();
      const ch = answer.trim().toLowerCase();
      if (ch === '1') cmdInstall(appDir);
      else if (ch === '2') cmdRestore(appDir);
    });
  }
}

main();
