# zhipu-plan-statusline

在 **Claude Code 状态栏**里常驻显示 **智谱 GLM Coding Plan** 套餐余量。

```
🤖 GLM(Pro) 5h:██░░░░░░░░ 3% · 7d:░░░░░░░░░░ 1% · 会话:2.1M
```

![状态栏实际效果](assets/statusline.png)

> 上图实际效果：第 1 行是 GSD 状态栏（模型 / 项目 / git / 上下文用量），原样保留；第 2 行是本工具显示的智谱套餐余量。

- **5h / 7d**：智谱主套餐的两个滚动 token 窗口用量百分比（满了会被限速）。绿 <60% / 黄 60–85% / 红 >85%。
- **会话**：当前 Claude Code 会话累计消耗的 token 数。
- 如果你原本有状态栏（比如 GSD），它的输出会**原样保留在最上面一行**，一行都不丢。

> 适用于用智谱 GLM Coding Plan（Lite/Pro/Max）跑 Claude Code 的人。macOS / Linux / Windows 通用。

---

## 工作原理

1. Claude Code 每次刷新状态栏时，把当前会话信息以 JSON 经 stdin 传给本脚本。
2. 本脚本先把你**原来的状态栏命令**（若有）原样跑一遍，输出第 1 行。
3. 再调用智谱官方接口 `GET /api/monitor/usage/quota/limit` 拿套餐用量（**5 分钟缓存**，避免被限速；缓存过期时后台静默刷新，前台不卡），输出第 2 行。
4. 鉴权用的 token 只从环境变量 / `settings.json` 读取，**绝不写盘、绝不外传**。

接口与鉴权方式与智谱官方 `glm-plan-usage` 插件一致，区别是本脚本把它**做成常驻状态栏**而不是手动敲命令。

---

## 系统要求

- **Node.js 18 或更高**（Claude Code 本身就需要 Node）
- **Claude Code CLI**
- 智谱 GLM Coding Plan 已订阅，且 Claude Code 已配置好智谱的 `ANTHROPIC_BASE_URL` 和 `ANTHROPIC_AUTH_TOKEN`

---

## 安装（macOS / Linux）

```bash
# 1. 进入项目目录（含 install.js 的那个）
cd zhipu-plan-statusline

# 2. 运行安装器
node install.js
```

安装器会自动：拷脚本到 `~/.claude/`、备份 `settings.json`、把原状态栏（如 GSD）包装保留、改好配置、跑一次冒烟测试。

然后**重启 Claude Code**，状态栏就生效了。

---

## 安装（Windows）⭐

### 前提
1. 装好 **Node.js 18+**：到 <https://nodejs.org> 下载 LTS 安装包，一路下一步。装完在 PowerShell 里输入 `node -v` 能看到版本号即可。
2. 装好 **Claude Code** 并能正常用智谱跑（即下面第 3 点的 token 已配好）。
3. **智谱 token 已配置**。打开 `C:\Users\你的用户名\.claude\settings.json`，确认 `env` 段里有这两项（值换成你自己的）：
   ```json
   {
     "env": {
       "ANTHROPIC_BASE_URL": "https://open.bigmodel.cn/api/anthropic",
       "ANTHROPIC_AUTH_TOKEN": "你的智谱-coding-key"
     }
   }
   ```
   > 如果你的 Claude Code 是用系统环境变量配的 token，也可以——脚本会优先读环境变量，读不到才回退到 `settings.json`。

### 步骤
1. **把整个项目文件夹拷到 Windows 机器**（U 盘 / 网盘 / `git clone` 都行），比如放到 `D:\tools\zhipu-plan-statusline`。
2. 打开 **PowerShell**（推荐）或 **Windows Terminal**：
   ```powershell
   cd D:\tools\zhipu-plan-statusline
   node install.js
   ```
3. 看到类似输出就成功了：
   ```
   ✓ Node v22.x.x  平台：win32
   • 脚本已安装 → C:\Users\你\.claude\zhipu-statusline.js
   • 已包装原状态栏（保留其输出）：...   ← 如果你之前有 GSD 等状态栏
   • 已备份 → settings.json.bak-2026-07-18T...
   • statusLine 已指向 → zhipu-statusline.js
   冒烟测试（首次会真实查询智谱接口，≤4s）：
     GLM(Pro) 5h:[##--------]3% | 7d:[#---------]1%
   ✓ 安装完成。请【重启 Claude Code】让状态栏生效。
   ```
4. **重启 Claude Code**。

### Windows 终端说明
- ✅ **Windows Terminal / VS Code 内置终端 / PowerShell 7**：完整彩色 + 方块进度条 + 🤖。
- ⚠️ **老式 cmd.exe（传统 conhost）**：脚本会**自动降级**成纯文本（`GLM(Pro) 5h:[##--------]3%`），数字照样准，只是没有颜色和方块。建议还是用 Windows Terminal，体验更好。

---

## 状态栏字段含义

| 字段 | 含义 |
|---|---|
| `GLM(Pro)` | 你的套餐等级（lite/pro/max，来自智谱接口） |
| `5h: ██░ 31%` | **5 小时**滚动 token 窗口已用百分比，满了会限速 |
| `7d: ██░ 11%` | **7 天**滚动 token 窗口已用百分比 |
| `会话: 142k` | 当前 Claude Code 会话累计消耗的 token |
| `GLM:未配置 token` | 没读到智谱 token，请检查环境变量 / `settings.json` |
| `GLM:--` | 有 token 但暂时没取到数据（首次后台刷新中，几秒后就有了） |

> 智谱主套餐是 5h + 7d 滚动窗口，没有"主 token 的月度"概念。接口里另有一个 `TIME_LIMIT` 是 MCP 工具（搜索/网页阅读）的月度配额，默认不展示——需要的话见下方 FAQ。

---

## 常见问题

**Q：装完重启后状态栏没变化 / 没出现套餐行？**
确认是**完全退出再重开** Claude Code（状态栏配置只在启动时读取）。还没出现就手动跑一下 `node ~/.claude/zhipu-statusline.js < /dev/null` 看报不报错。

**Q：颜色或方块 `█░` / 🤖 显示成乱码？**
你大概率在老式 cmd.exe 里。换成 Windows Terminal 或 VS Code 终端即可；或在脚本里它已自动降级为纯文本。

**Q：显示 `GLM:未配置 token`？**
脚本既没在环境变量、也没在 `~/.claude/settings.json` 的 `env` 段里找到 `ANTHROPIC_AUTH_TOKEN`。把智谱 coding key 配进去（参考 Windows 步骤第 3 点）。

**Q：原来的 GSD 状态栏不见了？**
不应该。安装器会把原状态栏命令记到 `~/.claude/.zhipu-statusline-config.json` 的 `wrapCommand` 里，新脚本会原样转发。如果确实没了，用备份恢复：把 `~/.claude/settings.json.bak-*` 之一覆盖回 `settings.json`，再重跑 `node install.js`。

**Q：想改刷新频率 / 颜色阈值 / 显示项？**
编辑 `~/.claude/zhipu-statusline.js` 顶部的「路径与可调配置」段：`QUOTA_TTL_MS`（套餐刷新间隔）、`BAR_WIDTH`（进度条格数）、颜色阈值在 `colorFor()`。改完即时生效，无需重装。

**Q：想加上 MCP 工具月度配额（TIME_LIMIT）？**
接口已返回，只是默认没展示。在 `zhipu-statusline.js` 的 `parseLimits` 里多取一条 `TIME_LIMIT`（字段 `percentage` / `remaining` / `usage`），再在主流程拼一行即可。

**Q：想强制刷新一下套餐数字？**
删掉缓存文件 `~/.claude/.zhipu-quota.json`，下一次状态栏渲染就会立刻拉新数据。

---

## 卸载 / 恢复

```bash
# 1. 用最近的备份恢复原 settings.json
ls ~/.claude/settings.json.bak-*        # 看有哪些备份
cp ~/.claude/settings.json.bak-最新时间 ~/.claude/settings.json

# 2. 删除本工具的文件（可选）
rm ~/.claude/zhipu-statusline.js
rm ~/.claude/.zhipu-statusline-config.json
rm ~/.claude/.zhipu-quota.json ~/.claude/.zhipu-session.json
```
然后重启 Claude Code。

---

## 数据与隐私

- token 只在内存里用于请求智谱官方接口，**不会写入任何缓存文件**（缓存里只有用量百分比）。
- 只请求智谱的 `quota/limit` 接口，不向任何第三方发送数据。
- 所有缓存文件都在你本机 `~/.claude/` 下，可随时删除。

---

## 致谢

- [stormzhang/token-tracker](https://github.com/stormzhang/token-tracker)——状态栏设计灵感。
- 智谱官方 [glm-plan-usage](https://github.com/zai-org/zai-coding-plugins) 插件——套餐用量接口与鉴权方式。

## License

MIT
