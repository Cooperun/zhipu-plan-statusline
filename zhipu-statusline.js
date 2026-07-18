#!/usr/bin/env node
/*
 * zhipu-statusline.js — Claude Code 状态栏：智谱 GLM Coding Plan 套餐余量
 *
 * 输出两行：
 *   第 1 行：转发你原来的状态栏（GSD 等），由安装器写入配置；没有就跳过。
 *   第 2 行：智谱套餐余量
 *           🤖 GLM(Pro) 5h:██░░░░░░░░ 9% (1h23m) · 7d:░░░░░░░░░░ 2% (5d8h) · 会话:2.1M
 *           老 Windows cmd.exe 自动降级为纯文本：
 *           GLM(Pro) 5h:[###-------]9% (1h23m) | 7d:[#---------]2% (5d8h) | sess:2.1M
 *
 * 鉴权：优先环境变量 ANTHROPIC_AUTH_TOKEN / ANTHROPIC_BASE_URL，缺失回退 settings.json。token 绝不写盘/打印。
 * 性能：套餐用量 5 分钟缓存、会话 token 10 秒缓存；过期后台异步刷新，前台永不卡顿。
 * 接口：GET https://<host>/api/monitor/usage/quota/limit（host 取自 ANTHROPIC_BASE_URL）
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const { spawn, spawnSync } = require('child_process');

// ---------- 路径与可调配置 ----------
const CLAUDE_DIR     = path.join(os.homedir(), '.claude');
const CONFIG_FILE    = path.join(CLAUDE_DIR, '.zhipu-statusline-config.json'); // 安装器写入：wrapCommand 等
const SETTINGS_FILE  = path.join(CLAUDE_DIR, 'settings.json');
const QUOTA_CACHE    = path.join(CLAUDE_DIR, '.zhipu-quota.json');
const SESSION_CACHE  = path.join(CLAUDE_DIR, '.zhipu-session.json');
const QUOTA_TTL_MS   = 5 * 60 * 1000;   // 套餐用量 5 分钟刷新
const SESSION_TTL_MS = 10 * 1000;       // 会话 token 10 秒刷新
const NET_TIMEOUT_MS = 4000;
const BAR_WIDTH      = 10;

// ---------- 配置 ----------
function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) || {}; } catch { return {}; }
}

// ---------- 终端能力：是否支持 ANSI 颜色 + Unicode（决定 rich / plain 渲染）----------
function supportsRich() {
  const e = process.env;
  if (e.COLORTERM) return true;                                       // 现代终端（iTerm/WT/VSCode）
  if (e.TERM_PROGRAM) return true;
  if (e.WT_SESSION) return true;                                      // Windows Terminal
  if (e.TERM && /color|xterm|screen|tmux|rxvt/i.test(e.TERM)) return true;
  if (process.platform !== 'win32') return true;                      // macOS/Linux 默认 OK
  return false;                                                       // Windows 老 cmd.exe 兜底降级
}

// ---------- ANSI ----------
const C = { reset:'\x1b[0m', dim:'\x1b[2m', green:'\x1b[32m', yellow:'\x1b[33m', red:'\x1b[31m', cyan:'\x1b[36m' };
function colorFor(pct) { return pct >= 85 ? C.red : pct >= 60 ? C.yellow : C.green; }
function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

// ---------- 鉴权 ----------
function getAuth() {
  let token = process.env.ANTHROPIC_AUTH_TOKEN || '';
  let base  = process.env.ANTHROPIC_BASE_URL || '';
  if (token && base) return { token, base };
  try {
    const env = (JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) || {}).env || {};
    token = token || env.ANTHROPIC_AUTH_TOKEN || '';
    base  = base  || env.ANTHROPIC_BASE_URL || '';
  } catch {}
  return { token, base };
}

// ---------- 缓存 ----------
function readJSON(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch { return {}; } }
function writeJSON(file, obj) { try { fs.writeFileSync(file, JSON.stringify(obj)); } catch {} }
function nowMs() { return Date.now(); }

// ---------- 转发原状态栏（GSD 等），命令来自配置 ----------
function runWrapped(stdinBuf) {
  const cmd = loadConfig().wrapCommand;
  if (!cmd) return '';
  try {
    const r = spawnSync(cmd, { input: stdinBuf, encoding: 'utf8', shell: true, timeout: 5000 });
    return (r.stdout || '').replace(/\n+$/, '');
  } catch { return ''; }
}

// ---------- 套餐用量 ----------
function fetchQuotaData() {
  return new Promise(resolve => {
    const { token, base } = getAuth();
    if (!token || !base) return resolve(null);
    let host;
    try { host = new URL(base).host; } catch { return resolve(null); }
    const req = https.get(`https://${host}/api/monitor/usage/quota/limit`, {
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      timeout: NET_TIMEOUT_MS,
    }, res => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => { try { const j = JSON.parse(buf); resolve(j && j.data ? j.data : null); } catch { resolve(null); } });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
  });
}
function parseLimits(data) {
  const out = { fivePct: null, weekPct: null, fiveReset: null, weekReset: null, level: null };
  if (!data) return out;
  if (data.level) out.level = cap(String(data.level));
  const tokens = (Array.isArray(data.limits) ? data.limits : []).filter(l => l.type === 'TOKENS_LIMIT');
  tokens.sort((a, b) => (a.nextResetTime || 0) - (b.nextResetTime || 0)); // 重置更早=5h，更晚=7d
  if (tokens[0]) { out.fivePct = tokens[0].percentage; out.fiveReset = tokens[0].nextResetTime; }
  if (tokens[1]) { out.weekPct = tokens[1].percentage; out.weekReset = tokens[1].nextResetTime; }
  return out;
}

// ---------- 会话 token ----------
function readSessionTotal(transcriptPath) {
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return null;
  let buf;
  try { buf = fs.readFileSync(transcriptPath, 'utf8'); } catch { return null; }
  const byId = new Map();
  for (const line of buf.split('\n')) {
    if (!line.trim()) continue;
    let j; try { j = JSON.parse(line); } catch { continue; }
    const u = j && j.message && j.message.usage, id = j && j.message && j.message.id;
    if (!u || !id) continue;
    const t = (u.input_tokens||0) + (u.output_tokens||0) + (u.cache_creation_input_tokens||0) + (u.cache_read_input_tokens||0);
    if (!byId.has(id) || t > byId.get(id)) byId.set(id, t);
  }
  let sum = 0; for (const v of byId.values()) sum += v;
  return sum;
}
function cachedSessionTotal(transcriptPath, sessionId) {
  const cache = readJSON(SESSION_CACHE);
  const key = sessionId || 'default';
  const entry = cache[key];
  if (entry && (nowMs() - entry.ts) < SESSION_TTL_MS) return entry.total;
  const total = readSessionTotal(transcriptPath);
  if (total !== null) {
    cache[key] = { ts: nowMs(), total };
    const keys = Object.keys(cache);
    keys.sort((a, b) => (cache[a].ts || 0) - (cache[b].ts || 0));
    while (keys.length > 10) delete cache[keys.shift()];
    writeJSON(SESSION_CACHE, cache);
  }
  return total;
}

// ---------- 格式化 ----------
function fmtTokens(n) {
  if (n == null) return '--';
  if (n < 1000) return String(n);
  if (n < 1e6) return (n / 1000).toFixed(n < 10000 ? 1 : 0).replace(/\.0$/, '') + 'k';
  return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
}
function barRich(pct) { const f = Math.round(pct/100*BAR_WIDTH), c = colorFor(pct); return c + '█'.repeat(f) + '░'.repeat(BAR_WIDTH-f) + C.reset; }
function barPlain(pct){ const f = Math.round(pct/100*BAR_WIDTH); return '[' + '#'.repeat(f) + '-'.repeat(BAR_WIDTH-f) + ']'; }
// 剩余毫秒 → "1h23m" / "5d8h" / "12m" / "<1m"；<=0 返回 null（已重置，等下次刷新）
function fmtDuration(ms) {
  if (!(ms > 0)) return null;
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d${h}h`;
  if (h > 0) return `${h}h${m}m`;
  if (m > 0) return `${m}m`;
  return '<1m';
}
// 拼一个窗口段：标签 + 进度条 + 百分比 + (距重置倒计时)
function win(label, pct, dur, rich) {
  const bar = rich ? barRich(pct) : barPlain(pct);
  const pctStr = rich ? `${colorFor(pct)}${pct}%${C.reset}` : `${pct}%`;
  const durStr = dur ? ` ${rich ? C.dim : ''}(${dur})${rich ? C.reset : ''}` : '';
  return `${label}:${bar}${rich ? ' ' : ''}${pctStr}${durStr}`;
}

function readStdin() {
  return new Promise(res => {
    if (process.stdin.isTTY) return res('');
    let d = ''; process.stdin.setEncoding('utf8');
    process.stdin.on('data', c => d += c);
    process.stdin.on('end', () => res(d));
    process.stdin.on('error', () => res(''));
  });
}

// ---------- 后台刷新 ----------
async function refreshMode() {
  const data = await fetchQuotaData();
  if (data) writeJSON(QUOTA_CACHE, { ts: nowMs(), data });
  process.exit(0);
}

// ---------- 主流程 ----------
async function main() {
  if (process.argv.includes('--refresh')) return refreshMode();
  const rich = supportsRich();

  const stdinBuf = await readStdin();
  const wrapOut = runWrapped(stdinBuf);
  let parsed = {}; try { parsed = JSON.parse(stdinBuf || '{}'); } catch {}

  const qcache = readJSON(QUOTA_CACHE), now = nowMs();
  let limits = null;
  const cachedQuota = qcache.data ? qcache : null;
  if (cachedQuota && (now - cachedQuota.ts) < QUOTA_TTL_MS) {
    limits = parseLimits(cachedQuota.data);
  } else if (cachedQuota) {
    limits = parseLimits(cachedQuota.data);
    try { spawn(process.execPath, [__filename, '--refresh'], { detached: true, stdio: 'ignore' }).unref(); } catch {}
  } else {
    const data = await fetchQuotaData();
    if (data) { writeJSON(QUOTA_CACHE, { ts: now, data }); limits = parseLimits(data); }
  }

  const sessionTotal = cachedSessionTotal(parsed.transcript_path, parsed.session_id);

  const segs = [];
  const haveLimits = limits && (limits.fivePct != null || limits.weekPct != null);
  if (haveLimits) {
    const tag = limits.level ? `GLM(${limits.level})` : 'GLM';
    const parts = [];
    if (limits.fivePct != null) parts.push(win('5h', limits.fivePct, fmtDuration((limits.fiveReset || 0) - now), rich));
    if (limits.weekPct  != null) parts.push(win('7d',  limits.weekPct, fmtDuration((limits.weekReset || 0) - now), rich));
    segs.push((rich ? `${C.cyan}🤖 ${tag}${C.reset} ` : `${tag} `) + parts.join(rich ? ` ${C.dim}·${C.reset} ` : ' | '));
  } else if (!getAuth().token) {
    segs.push(rich ? `${C.dim}GLM:未配置 token${C.reset}` : 'GLM:未配置token');
  } else {
    segs.push(rich ? `${C.dim}GLM:--${C.reset}` : 'GLM:--');
  }
  if (sessionTotal != null) segs.push(rich ? `${C.dim}会话:${C.reset}${fmtTokens(sessionTotal)}` : `sess:${fmtTokens(sessionTotal)}`);

  const line2 = segs.join(rich ? ` ${C.dim}·${C.reset} ` : ' | ');
  if (wrapOut) process.stdout.write(wrapOut + '\n');
  if (line2) process.stdout.write(line2 + '\n');
}

main().catch(() => {}); // 状态栏绝不能抛错打断 Claude Code
