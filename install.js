#!/usr/bin/env node
/*
 * install.js — zhipu-plan-statusline 跨平台安装器（macOS / Linux / Windows）
 *
 * 用法：  node install.js
 * 做什么：
 *   1) 把 zhipu-statusline.js 拷到 ~/.claude/
 *   2) 探测你原有的 statusLine（如 GSD），写入配置，由新脚本原样转发——不丢任何信息
 *   3) 备份 settings.json（带时间戳）
 *   4) 把 settings.json 的 statusLine 指向新脚本（保留文件其余内容与格式）
 *   5) 跑一次冒烟测试，确认脚本能正常输出
 *
 * 纯 Node 实现，不依赖任何 shell 命令，Windows 上同样可用。
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const CLAUDE_DIR    = path.join(os.homedir(), '.claude');
const SETTINGS_FILE = path.join(CLAUDE_DIR, 'settings.json');
const CONFIG_FILE   = path.join(CLAUDE_DIR, '.zhipu-statusline-config.json');
const SCRIPT_NAME   = 'zhipu-statusline.js';
const SRC_SCRIPT    = path.join(__dirname, SCRIPT_NAME);
const DST_SCRIPT    = path.join(CLAUDE_DIR, SCRIPT_NAME);
const SELF_MARKER   = 'zhipu-statusline.js';
const SL_RE         = /"statusLine"\s*:\s*\{[^{}]*\}/; // statusLine 块（块内无嵌套大括号）

function step(msg) { console.log('• ' + msg); }

// ---- 0. 环境检查 ----
const major = Number(process.versions.node.split('.')[0]);
if (major < 18) { console.error(`✗ 需要 Node 18+，当前是 ${process.versions.node}。请先升级 Node。`); process.exit(1); }
console.log(`✓ Node ${process.versions.node}  平台：${process.platform}`);

if (!fs.existsSync(SRC_SCRIPT)) { console.error(`✗ 当前目录找不到 ${SCRIPT_NAME}。请在项目根目录（含该文件的目录）运行本安装器。`); process.exit(1); }

// ---- 1. 建目录 + 拷脚本 ----
fs.mkdirSync(CLAUDE_DIR, { recursive: true });
fs.copyFileSync(SRC_SCRIPT, DST_SCRIPT);
step(`脚本已安装 → ${DST_SCRIPT}`);

// ---- 2. 读 settings.json ----
let settingsText = '';
try { settingsText = fs.readFileSync(SETTINGS_FILE, 'utf8'); } catch { settingsText = ''; }

// ---- 3. 提取原有 statusLine 命令（用于包装转发）----
let oldCmd = null;
const slMatch = settingsText.match(SL_RE);
if (slMatch) {
  const cmdMatch = slMatch[0].match(/"command"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (cmdMatch) { try { oldCmd = JSON.parse('"' + cmdMatch[1] + '"'); } catch {} }
}

// ---- 4. 决定 wrapCommand（要包装转发的原状态栏）----
let existingConfig = {};
try { existingConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) || {}; } catch {}
let wrapCommand = null;
if (oldCmd && !oldCmd.includes(SELF_MARKER)) {
  wrapCommand = oldCmd;                              // 首次安装：把原状态栏（GSD 等）包进来
} else {
  wrapCommand = existingConfig.wrapCommand || null;  // 重装：保留上次记录的 wrap，避免丢失
}
fs.writeFileSync(CONFIG_FILE, JSON.stringify({ wrapCommand }, null, 2) + '\n');
step(wrapCommand ? `已包装原状态栏（保留其输出）：${wrapCommand}` : '未发现已有 statusLine，状态栏只显示套餐余量');

// ---- 5. 备份 settings.json ----
if (settingsText.trim()) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const bak = `${SETTINGS_FILE}.bak-${ts}`;
  fs.writeFileSync(bak, settingsText);
  step(`已备份 → ${path.basename(bak)}`);
}

// ---- 6. 改写 statusLine 指向新脚本 ----
const newCmdRaw = `"${process.execPath}" "${DST_SCRIPT}"`;
const newCmdEsc = newCmdRaw.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const newBlock =
  '"statusLine" : {\n' +
  `    "command" : "${newCmdEsc}",\n` +
  '    "type" : "command"\n' +
  '  }';

let newSettings;
if (slMatch) {
  // 已有 statusLine 块：原地替换，其余内容逐字节保留
  newSettings = settingsText.replace(SL_RE, newBlock);
} else if (settingsText.trim()) {
  // 没有 statusLine 块：插到最后的 } 之前
  const trimmed = settingsText.trimEnd();
  const lastBrace = trimmed.lastIndexOf('}');
  if (lastBrace === -1) { console.error('✗ settings.json 格式异常（找不到闭合 }），已备份，请手动添加 statusLine。'); process.exit(1); }
  const head = trimmed.slice(0, lastBrace).trimEnd();
  const lastChar = head.slice(-1);
  const sep = (lastChar === '{' || lastChar === ',') ? '' : ',';
  newSettings = head + sep + '\n  ' + newBlock + '\n}\n';
} else {
  // 没有 settings.json：新建
  newSettings = '{\n  ' + newBlock + '\n}\n';
}
fs.writeFileSync(SETTINGS_FILE, newSettings);
step(`statusLine 已指向 → ${SCRIPT_NAME}`);

// ---- 7. 冒烟测试 ----
console.log('');
console.log('冒烟测试（首次会真实查询智谱接口，≤4s）：');
const r = spawnSync(process.execPath, [DST_SCRIPT], {
  input: JSON.stringify({ session_id: 'install-smoke', transcript_path: '', cwd: process.cwd(),
    model: { display_name: 'Test' }, workspace: { current_dir: process.cwd() } }),
  encoding: 'utf8', timeout: 12000,
});
const out = (r.stdout || '').trim();
if (out) {
  console.log(out.split('\n').map(l => '  ' + l).join('\n'));
} else {
  console.log('  ⚠ 无输出。stderr: ' + (r.stderr || '').trim().slice(0, 200));
  console.log('  （状态栏脚本仍已安装，重启 Claude Code 后再看实际效果。）');
}

// ---- 8. 完成 ----
console.log('');
console.log('✓ 安装完成。请【重启 Claude Code】让状态栏生效。');
console.log('  恢复原状态栏：把任意一个 .bak-* 备份覆盖回 settings.json 即可。');
