# Recovering from a Cascading Bot Failure

> 适用于所有 agentic IDE / CLI（Cursor / ZCode / Claude Code / Codex 等）

## 症状

注册任何一个 **tel robot / chat bridge bot**（Telegram / Slack / Discord / 飞书 / 钉钉 / Webhook 桥）后，如果该 bot 第一次连接失败（tok 错误 / 网络中断 / bind 失败），很多 agentic runtime 会做下面这套连锁反应：

1. 主 agent 在 connector boot 阶段抛错
2. connector manager 简单粗暴地 close / stop 全部子 agent（"broken boot → reset"）
3. 所有机器人（包括正常可用的）→ 全部失能
4. 用户只能重启整个 runtime

## 解决策略（来自 harness-core 的 SubagentManager 设计）

把 connect 失败的处理从「全量 reset」改成「**per-subagent quarantine**」：

```
当机器人发起 connect
  ├─ 成功 → 标记为 active，正常工作
  └─ 失败 → 进入 quarantine（隔离态）
        ├─ 标记 bind_failure_count++
        ├─ 不向主代理回报不可用（避免级联）
        ├─ 启动后台 retry：指数退避 1s → 30s
        └─ 期间其它机器人照常工作
```

### 关键原则

1. **隔离失败**：单个机器人 bind 失败只影响自己，不影响其他机器人或主代理
2. **优雅重试**：失败 bot 用指数退避在后台 retry，不阻塞主代理
3. **可观测**：UI 上把"被隔离"的机器人展示出来，标注原因（不是隐藏）
4. **可手动开通**：用户可以一键 "Retry now" / "Disable" 当个 bot
5. **可关闭整个机器人通道**：在最坏情况下给用户一个 emergency kill-switch

## 在 harness-core 里的实现范式

我们的 `SubagentManager` 已实现 per-subagent 隔离：`spawn / fork / resume / remove` 各自独立。
任何 subagent 失败只影响该 subagent 自己的 status，不会触发其他 subagent cancellation。

## 在 UI 里的提示

如果遇到"注册 tel 机器人后所有机器人失能"，按照下面的顺序排查：

1. **关闭刚注册的机器人**（在 bot settings 里 toggle off）
2. **重启 runtime / IDE**
3. **重新逐个注册机器人**，每次注册后等待 5 秒，确保 bind 通
4. **如果只有一个机器人 bind 失败**：保留其它机器人正常用，禁用这个 → 提交 bug

## 临时 workaround

如果机器人通道整个挂掉，IDE 内部依然能正常用：

- 用 IDE 内置 chat（**不要**依赖外部机器人）
- 工作流跑完后，导出 session log（见 `claude-account-restore.md`）
- 关闭 IDE 的 bot bridge 开关
