/**
 * job-gap-analysis.canvas.tsx
 *
 * DataFoundry 功能差距分析 — 匹配岗位职责技术要求
 * 分析日期: 2026-08-23
 *
 * 岗位职责:
 *   1. 数据策略与标准制定: 数据分布策略、采样方案、标注 SOP
 *   2. 自动化工作流建设: Prompt 工程、Coze/LangChain 等工作流、数据生产链路
 *   3. 评测闭环驱动: 业务场景评测集、"评测-数据-模型"迭代闭环
 *
 * 岗位要求:
 *   精通提示词工程(PE)、熟悉大模型工作流搭建、习惯 Cursor 等 AI 辅助编程
 */

import React from 'react'

// ── 术语对照 ────────────────────────────────────────────────────────────
// PE = Prompt Engineering
// 评测集 = Evaluation Dataset / Benchmark
// 工作流 = Workflow / Pipeline
// 数据生产链路 = Data Production Pipeline
// 自动化率 = Automation Rate
// HITL = Human-In-The-Loop

export default function JobGapAnalysis() {
  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 900, margin: '0 auto', padding: '40px 24px', lineHeight: 1.6 }}>

      {/* Header */}
      <header style={{ borderBottom: '2px solid #e5e7eb', paddingBottom: 24, marginBottom: 40 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, margin: '0 0 8px' }}>
          DataFoundry 功能差距分析
        </h1>
        <p style={{ color: '#6b7280', fontSize: 15, margin: 0 }}>
          匹配岗位职责 1-3 的技术要求 × DataFoundry 当前能力
        </p>
        <p style={{ color: '#9ca3af', fontSize: 13, marginTop: 8 }}>
          分析日期: 2026-08-23 · 关键文件: agent-eval.ts, goal-runner.ts, agent-runtime/src/index.ts
        </p>
      </header>

      {/* ── 岗位职责 1: 数据策略与标准制定 ──────────────────────────── */}
      <section style={{ marginBottom: 48 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ background: '#fef3c7', color: '#92400e', padding: '2px 10px', borderRadius: 6, fontSize: 13 }}>职责 1</span>
          数据策略与标准制定
        </h2>
        <p style={{ color: '#374151', marginBottom: 20 }}>
          深入垂直领域分析模型短板，制定高质量的数据分布策略、采样方案及标注标准（SOP）。
        </p>

        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ background: '#f9fafb' }}>
              <th style={{ textAlign: 'left', padding: '10px 12px', border: '1px solid #e5e7eb' }}>技术要求</th>
              <th style={{ textAlign: 'left', padding: '10px 12px', border: '1px solid #e5e7eb' }}>DataFoundry 现状</th>
              <th style={{ textAlign: 'left', padding: '10px 12px', border: '1px solid #e5e7eb' }}>状态</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ padding: '10px 12px', border: '1px solid #e5e7eb' }}>数据分布策略(Distribution Strategy)</td>
              <td style={{ padding: '10px 12px', border: '1px solid #e5e7eb', color: '#6b7280' }}>
                无 — 无数据采样、分布配置界面；无领域特定数据集定义
              </td>
              <td style={{ padding: '10px 12px', border: '1px solid #e5e7eb' }}>
                <span style={{ background: '#fee2e2', color: '#991b1b', padding: '2px 8px', borderRadius: 4, fontSize: 12 }}>缺失</span>
              </td>
            </tr>
            <tr>
              <td style={{ padding: '10px 12px', border: '1px solid #e5e7eb' }}>采样方案(Sampling Schema)</td>
              <td style={{ padding: '10px 12px', border: '1px solid #e5e7eb', color: '#6b7280' }}>
                无 — data-gateway 包有 field-masking / sampling policy 定义(代码层面)，但无 UI 配置入口
              </td>
              <td style={{ padding: '10px 12px', border: '1px solid #e5e7eb' }}>
                <span style={{ background: '#fef3c7', color: '#92400e', padding: '2px 8px', borderRadius: 4, fontSize: 12 }}>仅代码层</span>
              </td>
            </tr>
            <tr>
              <td style={{ padding: '10px 12px', border: '1px solid #e5e7eb' }}>标注标准 SOP</td>
              <td style={{ padding: '10px 12px', border: '1px solid #e5e7eb', color: '#6b7280' }}>
                无 — 文档仅在 README/docs 描述，无结构化 SOP 管理
              </td>
              <td style={{ padding: '10px 12px', border: '1px solid #e5e7eb' }}>
                <span style={{ background: '#fee2e2', color: '#991b1b', padding: '2px 8px', borderRadius: 4, fontSize: 12 }}>缺失</span>
              </td>
            </tr>
            <tr>
              <td style={{ padding: '10px 12px', border: '1px solid #e5e7eb' }}>垂直领域分析能力</td>
              <td style={{ padding: '10px 12px', border: '1px solid #e5e7eb', color: '#6b7280' }}>
                中等 — knowledge 包有 chunking + citation 策略；无领域诊断工具
              </td>
              <td style={{ padding: '10px 12px', border: '1px solid #e5e7eb' }}>
                <span style={{ background: '#fef3c7', color: '#92400e', padding: '2px 8px', borderRadius: 4, fontSize: 12 }}>部分</span>
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      {/* ── 岗位职责 2: 自动化工作流建设 ──────────────────────────── */}
      <section style={{ marginBottom: 48 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ background: '#dbeafe', color: '#1e40af', padding: '2px 10px', borderRadius: 6, fontSize: 13 }}>职责 2</span>
          自动化工作流建设
        </h2>
        <p style={{ color: '#374151', marginBottom: 20 }}>
          负责高质量提示词(Prompt)的编写与迭代，设计基于 Agent/Workflow(Coze/LangChain等)的自动化数据生产链路。
        </p>

        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ background: '#f9fafb' }}>
              <th style={{ textAlign: 'left', padding: '10px 12px', border: '1px solid #e5e7eb' }}>技术要求</th>
              <th style={{ textAlign: 'left', padding: '10px 12px', border: '1px solid #e5e7eb' }}>DataFoundry 现状</th>
              <th style={{ textAlign: 'left', padding: '10px 12px', border: '1px solid #e5e7eb' }}>状态</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ padding: '10px 12px', border: '1px solid #e5e7eb' }}>工作流可视化编辑器<br /><span style={{ fontSize: 12, color: '#9ca3af' }}>(Coze/LangChain 类比)</span></td>
              <td style={{ padding: '10px 12px', border: '1px solid #e5e7eb', color: '#6b7280' }}>
                <strong style={{ color: '#1f2937' }}>部分</strong> — 有 step-phase typed pipeline 系统(inspect/query/transform/visualise/fetch)；
                有 trace-dag 可视化；<strong>无</strong>拖拽式工作流编辑器
              </td>
              <td style={{ padding: '10px 12px', border: '1px solid #e5e7eb' }}>
                <span style={{ background: '#dbeafe', color: '#1e40af', padding: '2px 8px', borderRadius: 4, fontSize: 12 }}>基础有,编辑器缺</span>
              </td>
            </tr>
            <tr>
              <td style={{ padding: '10px 12px', border: '1px solid #e5e7eb' }}>多 Agent 编排(Orchestrator)</td>
              <td style={{ padding: '10px 12px', border: '1px solid #e5e7eb', color: '#6b7280' }}>
                <strong style={{ color: '#059669' }}>已实现</strong> — harness-core 有 Orchestrator 类 +
                SubAgentManager；LATS tree-search 在 agent-runtime；Session 有 EventBus
              </td>
              <td style={{ padding: '10px 12px', border: '1px solid #e5e7eb' }}>
                <span style={{ background: '#d1fae5', color: '#065f46', padding: '2px 8px', borderRadius: 4, fontSize: 12 }}>已有</span>
              </td>
            </tr>
            <tr>
              <td style={{ padding: '10px 12px', border: '1px solid #e5e7eb' }}>Goal 驱动迭代验证循环</td>
              <td style={{ padding: '10px 12px', border: '1px solid #e5e7eb', color: '#6b7280' }}>
                <strong style={{ color: '#059669' }}>已实现</strong> — harness-core/goal/goal-runner.ts:
                predicate/regex/gateResult/command 四种 verifier；maxRounds=8；反馈注入 prompt
              </td>
              <td style={{ padding: '10px 12px', border: '1px solid #e5e7eb' }}>
                <span style={{ background: '#d1fae5', color: '#065f46', padding: '2px 8px', borderRadius: 4, fontSize: 12 }}>已有</span>
              </td>
            </tr>
            <tr>
              <td style={{ padding: '10px 12px', border: '1px solid #e5e7eb' }}>Prompt 版本管理与迭代追踪</td>
              <td style={{ padding: '10px 12px', border: '1px solid #e5e7eb', color: '#6b7280' }}>
                无 — skills/SKILL.md 有 prompt 模板；无 prompt 版本化、AB 测试、迭代 diff
              </td>
              <td style={{ padding: '10px 12px', border: '1px solid #e5e7eb' }}>
                <span style={{ background: '#fee2e2', color: '#991b1b', padding: '2px 8px', borderRadius: 4, fontSize: 12 }}>缺失</span>
              </td>
            </tr>
            <tr>
              <td style={{ padding: '10px 12px', border: '1px solid #e5e7eb' }}>自动化数据生产链路<br /><span style={{ fontSize: 12, color: '#9ca3af' }}>(数据 → 模型 → 评测)</span></td>
              <td style={{ padding: '10px 12px', border: '1px solid #e5e7eb', color: '#6b7280' }}>
                无 — 无数据生产工作流；data-gateway 仅有连接，无自动 ETL pipeline
              </td>
              <td style={{ padding: '10px 12px', border: '1px solid #e5e7eb' }}>
                <span style={{ background: '#fee2e2', color: '#991b1b', padding: '2px 8px', borderRadius: 4, fontSize: 12 }}>缺失</span>
              </td>
            </tr>
            <tr>
              <td style={{ padding: '10px 12px', border: '1px solid #e5e7eb' }}>Coze/LangChain 集成</td>
              <td style={{ padding: '10px 12px', border: '1px solid #e5e7eb', color: '#6b7280' }}>
                无 — 使用 @mastra/core 自建 Runtime；agent-runtime 基于 LATS；无 Coze/LangChain adapter
              </td>
              <td style={{ padding: '10px 12px', border: '1px solid #e5e7eb' }}>
                <span style={{ background: '#fee2e2', color: '#991b1b', padding: '2px 8px', borderRadius: 4, fontSize: 12 }}>缺失(自建栈)</span>
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      {/* ── 岗位职责 3: 评测闭环驱动 ──────────────────────────── */}
      <section style={{ marginBottom: 48 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ background: '#ede9fe', color: '#5b21b6', padding: '2px 10px', borderRadius: 6, fontSize: 13 }}>职责 3</span>
          评测闭环驱动
        </h2>
        <p style={{ color: '#374151', marginBottom: 20 }}>
          构建贴合业务场景的应用层评测集，协同完成"评测-数据-模型"的迭代闭环。
        </p>

        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ background: '#f9fafb' }}>
              <th style={{ textAlign: 'left', padding: '10px 12px', border: '1px solid #e5e7eb' }}>技术要求</th>
              <th style={{ textAlign: 'left', padding: '10px 12px', border: '1px solid #e5e7eb' }}>DataFoundry 现状</th>
              <th style={{ textAlign: 'left', padding: '10px 12px', border: '1px solid #e5e7eb' }}>状态</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ padding: '10px 12px', border: '1px solid #e5e7eb' }}>业务场景评测集<br /><span style={{ fontSize: 12, color: '#9ca3af' }}>(Domain-specific Eval Datasets)</span></td>
              <td style={{ padding: '10px 12px', border: '1px solid #e5e7eb', color: '#6b7280' }}>
                无 — 无结构化评测集存储；无场景化 benchmark 定义
              </td>
              <td style={{ padding: '10px 12px', border: '1px solid #e5e7eb' }}>
                <span style={{ background: '#fee2e2', color: '#991b1b', padding: '2px 8px', borderRadius: 4, fontSize: 12 }}>缺失</span>
              </td>
            </tr>
            <tr>
              <td style={{ padding: '10px 12px', border: '1px solid #e5e7eb' }}>运行时 Eval 追踪</td>
              <td style={{ padding: '10px 12px', border: '1px solid #e5e7eb', color: '#6b7280' }}>
                <strong style={{ color: '#059669' }}>部分实现</strong> — agent-eval.ts 有 EvalRecord +
                evalSnapshot()；追踪 automation_result / quality_score / p50-p99 latency；
                Prometheus 输出到 /metrics；24h 滚动窗口；内存存储(未持久化到 Supabase)
              </td>
              <td style={{ padding: '10px 12px', border: '1px solid #e5e7eb' }}>
                <span style={{ background: '#dbeafe', color: '#1e40af', padding: '2px 8px', borderRadius: 4, fontSize: 12 }}>部分,缺持久化</span>
              </td>
            </tr>
            <tr>
              <td style={{ padding: '10px 12px', border: '1px solid #e5e7eb' }}>评测 → Prompt 迭代反馈环</td>
              <td style={{ padding: '10px 12px', border: '1px solid #e5e7eb', color: '#6b7280' }}>
                无 — eval 数据无自动触发 prompt 改进的机制；无评测失败分析
              </td>
              <td style={{ padding: '10px 12px', border: '1px solid #e5e7eb' }}>
                <span style={{ background: '#fee2e2', color: '#991b1b', padding: '2px 8px', borderRadius: 4, fontSize: 12 }}>缺失</span>
              </td>
            </tr>
            <tr>
              <td style={{ padding: '10px 12px', border: '1px solid #e5e7eb' }}>评测 → 数据集改进反馈环</td>
              <td style={{ padding: '10px 12px', border: '1px solid #e5e7eb', color: '#6b7280' }}>
                无 — 评测失败案例无自动标注、分流到数据队列的机制
              </td>
              <td style={{ padding: '10px 12px', border: '1px solid #e5e7eb' }}>
                <span style={{ background: '#fee2e2', color: '#991b1b', padding: '2px 8px', borderRadius: 4, fontSize: 12 }}>缺失</span>
              </td>
            </tr>
            <tr>
              <td style={{ padding: '10px 12px', border: '1px solid #e5e7eb' }}>Admin Dashboard 评测面板</td>
              <td style={{ padding: '10px 12px', border: '1px solid #e5e7eb', color: '#6b7280' }}>
                <strong style={{ color: '#059669' }}>部分实现</strong> — admin-metrics-panel.ts 有 stats；无专用评测集管理 UI
              </td>
              <td style={{ padding: '10px 12px', border: '1px solid #e5e7eb' }}>
                <span style={{ background: '#fef3c7', color: '#92400e', padding: '2px 8px', borderRadius: 4, fontSize: 12 }}>部分</span>
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      {/* ── 岗位要求技术能力映射 ─────────────────────────────── */}
      <section style={{ marginBottom: 48 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>岗位要求 → DataFoundry 功能映射</h2>

        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '14px 16px' }}>
            <strong style={{ color: '#166534' }}>精通提示词工程(PE)</strong>
            <span style={{ color: '#374151', marginLeft: 8 }}>→ DataFoundry 有 agent-instructions.ts(buildAgentInstructions)；
            skills/SKILL.md 为 prompt 模板格式；无独立 PE 编辑器/版本管理/AB 测试 → </span>
            <strong style={{ color: '#dc2626' }}>需补充</strong>
          </div>
          <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '14px 16px' }}>
            <strong style={{ color: '#1e40af' }}>熟悉大模型工作流搭建</strong>
            <span style={{ color: '#374151', marginLeft: 8 }}>→ 有 Orchestrator + SubAgentManager + GoalRunner + step-phase typed pipeline；
            无可视化编辑器；无 LangChain/Coze 集成 → </span>
            <strong style={{ color: '#dc2626' }}>需补充可视化编辑器</strong>
          </div>
          <div style={{ background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: 8, padding: '14px 16px' }}>
            <strong style={{ color: '#5b21b6' }}>习惯 Cursor 等 AI 辅助编程</strong>
            <span style={{ color: '#374151', marginLeft: 8 }}>→ 项目已配置 Cursor rules(vibe-coding-cn, karpathy-guidelines)；本项目本身就是 Cursor IDE 配置的；
            用户已在使用 Cursor → </span>
            <strong style={{ color: '#16a34a' }}>已满足</strong>
          </div>
        </div>
      </section>

      {/* ── 待建设清单(按优先级) ─────────────────────────────── */}
      <section style={{ marginBottom: 48 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 20 }}>待建设功能清单(按优先级)</h2>

        <div style={{ display: 'grid', gap: 16 }}>

          {/* P0 */}
          <div style={{ border: '2px solid #dc2626', borderRadius: 10, overflow: 'hidden' }}>
            <div style={{ background: '#fef2f2', padding: '10px 16px', fontWeight: 700, color: '#991b1b', fontSize: 15 }}>
              P0 — 职责 3 核心: 评测数据持久化 + 业务场景评测集
            </div>
            <div style={{ padding: '14px 16px', fontSize: 14 }}>
              <p style={{ margin: '0 0 8px', color: '#374151' }}>
                <strong>目标:</strong> 将 agent-eval.ts 的内存滚动窗口持久化到 Supabase(dfd_runs + dfd_token_usage)，并建立场景化评测集存储。
              </p>
              <ul style={{ margin: 0, paddingLeft: 20, color: '#6b7280' }}>
                <li>Supabase 表: dfd_eval_runs / dfd_eval_datasets / dfd_eval_cases</li>
                <li>apps/api/routes/eval-datasets.ts — CRUD 评测集(POST/GET/PUT/DELETE)</li>
                <li>apps/api/routes/eval-runs.ts — 写入每次 eval 结果</li>
                <li>apps/web/src/app/admin/eval-dashboard/ — 评测管理 UI(评测集列表 + 运行历史 + 趋势图)</li>
                <li>评测集定义格式(JSON Schema): name, domain, description, test_cases[], scoring_criteria[]</li>
              </ul>
            </div>
          </div>

          {/* P1 */}
          <div style={{ border: '2px solid #d97706', borderRadius: 10, overflow: 'hidden' }}>
            <div style={{ background: '#fffbeb', padding: '10px 16px', fontWeight: 700, color: '#92400e', fontSize: 15 }}>
              P1 — 职责 2 核心: 可视化工作流编辑器
            </div>
            <div style={{ padding: '14px 16px', fontSize: 14 }}>
              <p style={{ margin: '0 0 8px', color: '#374151' }}>
                <strong>目标:</strong> 在 data-tasks UI 左侧添加工作流编辑器面板，支持拖拽 step-phase 节点，构建 task graph。
              </p>
              <ul style={{ margin: 0, paddingLeft: 20, color: '#6b7280' }}>
                <li>apps/web/src/app/data-tasks/components/workflow/WorkflowBuilder.tsx — 拖拽式节点编辑器</li>
                <li>节点类型: trigger(触发器) / inspect / query / transform / visualise / fetch / reason / HITL(人工确认)</li>
                <li>apps/api/routes/workflows.ts — 工作流 CRUD + 执行 API</li>
                <li>packages/harness-core/ 新增 workflow-runtime.ts — 将可视化工作流编译为 GoalRunner 配置</li>
                <li>apps/web/src/app/data-tasks/components/workflow/WorkflowCanvas.tsx — SVG/Canvas 渲染工作流图</li>
              </ul>
            </div>
          </div>

          {/* P2 */}
          <div style={{ border: '2px solid #2563eb', borderRadius: 10, overflow: 'hidden' }}>
            <div style={{ background: '#eff6ff', padding: '10px 16px', fontWeight: 700, color: '#1e40af', fontSize: 15 }}>
              P2 — 职责 3 补充: 评测 → Prompt 迭代反馈环
            </div>
            <div style={{ padding: '14px 16px', fontSize: 14 }}>
              <p style={{ margin: '0 0 8px', color: '#374151' }}>
                <strong>目标:</strong> 评测失败的 case 自动建议 prompt 修改建议，结合 GoalRunner verifier 结果驱动 skill prompt 迭代。
              </p>
              <ul style={{ margin: 0, paddingLeft: 20, color: '#6b7280' }}>
                <li>apps/api/routes/eval-insights.ts — 分析失败模式，提取 prompt 改进建议</li>
                <li>packages/skills/ 新增 eval-feedback-skill/ — 自动分析 eval failure → skill prompt diff</li>
                <li>apps/web/src/app/data-tasks/components/eval/Ev alFailureAnalysis.tsx — 展示 top failure patterns</li>
                <li>数据生产链路: eval failure case → knowledge base → agent context injection</li>
              </ul>
            </div>
          </div>

          {/* P3 */}
          <div style={{ border: '2px solid #7c3aed', borderRadius: 10, overflow: 'hidden' }}>
            <div style={{ background: '#f5f3ff', padding: '10px 16px', fontWeight: 700, color: '#5b21b6', fontSize: 15 }}>
              P3 — 职责 1: 数据策略配置 UI + 标注 SOP 管理
            </div>
            <div style={{ padding: '14px 16px', fontSize: 14 }}>
              <p style={{ margin: '0 0 8px', color: '#374151' }}>
                <strong>目标:</strong> 在 admin panel 添加数据策略配置和 SOP 管理界面。
              </p>
              <ul style={{ margin: 0, paddingLeft: 20, color: '#6b7280' }}>
                <li>apps/web/src/app/admin/data-policy-panel/ — 采样策略、field-masking 配置 UI</li>
                <li>apps/api/routes/data-policy.ts — 策略 CRUD</li>
                <li>apps/api/routes/sop.ts — 标注 SOP CRUD(版本化 + diff)</li>
                <li>packages/knowledge/ 新增 data-policy.ts — 策略执行引擎</li>
              </ul>
            </div>
          </div>

        </div>
      </section>

      {/* ── 技术架构对照 ─────────────────────────────────── */}
      <section style={{ marginBottom: 48 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>技术架构对照(Coze/LangChain 类比)</h2>

        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#f9fafb' }}>
              <th style={{ textAlign: 'left', padding: '8px 12px', border: '1px solid #e5e7eb' }}>组件层</th>
              <th style={{ textAlign: 'left', padding: '8px 12px', border: '1px solid #e5e7eb' }}>Coze/LangChain 类比</th>
              <th style={{ textAlign: 'left', padding: '8px 12px', border: '1px solid #e5e7eb' }}>DataFoundry 现状</th>
              <th style={{ textAlign: 'left', padding: '8px 12px', border: '1px solid #e5e7eb' }}>差距</th>
            </tr>
          </thead>
          <tbody style={{ fontSize: 13 }}>
            <tr>
              <td style={{ padding: '8px 12px', border: '1px solid #e5e7eb' }}>工作流编辑器</td>
              <td style={{ padding: '8px 12px', border: '1px solid #e5e7eb', color: '#6b7280' }}>Coze Bot Canvas</td>
              <td style={{ padding: '8px 12px', border: '1px solid #e5e7eb', color: '#6b7280' }}>无可视化编辑器，仅有 chat interface</td>
              <td style={{ padding: '8px 12px', border: '1px solid #e5e7eb' }}><span style={{ background: '#fee2e2', color: '#991b1b', padding: '1px 6px', borderRadius: 3, fontSize: 11 }}>缺</span></td>
            </tr>
            <tr>
              <td style={{ padding: '8px 12px', border: '1px solid #e5e7eb' }}>Agent Runtime</td>
              <td style={{ padding: '8px 12px', border: '1px solid #e5e7eb', color: '#6b7280' }}>LangChain Agents</td>
              <td style={{ padding: '8px 12px', border: '1px solid #e5e7eb', color: '#059669' }}>@mastra/core + LATS tree-search + Orchestrator</td>
              <td style={{ padding: '8px 12px', border: '1px solid #e5e7eb' }}><span style={{ background: '#d1fae5', color: '#065f46', padding: '1px 6px', borderRadius: 3, fontSize: 11 }}>已有</span></td>
            </tr>
            <tr>
              <td style={{ padding: '8px 12px', border: '1px solid #e5e7eb' }}>工具/Tool</td>
              <td style={{ padding: '8px 12px', border: '1px solid #e5e7eb', color: '#6b7280' }}>LangChain Tools</td>
              <td style={{ padding: '8px 12px', border: '1px solid #e5e7eb', color: '#059669' }}>harness-core plugins/ + MCP servers</td>
              <td style={{ padding: '8px 12px', border: '1px solid #e5e7eb' }}><span style={{ background: '#d1fae5', color: '#065f46', padding: '1px 6px', borderRadius: 3, fontSize: 11 }}>已有</span></td>
            </tr>
            <tr>
              <td style={{ padding: '8px 12px', border: '1px solid #e5e7eb' }}>Memory/Context</td>
              <td style={{ padding: '8px 12px', border: '1px solid #e5e7eb', color: '#6b7280' }}>LangChain Memory</td>
              <td style={{ padding: '8px 12px', border: '1px solid #e5e7eb', color: '#059669' }}>conversation-memory-bridge + knowledge retrieval</td>
              <td style={{ padding: '8px 12px', border: '1px solid #e5e7eb' }}><span style={{ background: '#d1fae5', color: '#065f46', padding: '1px 6px', borderRadius: 3, fontSize: 11 }}>已有</span></td>
            </tr>
            <tr>
              <td style={{ padding: '8px 12px', border: '1px solid #e5e7eb' }}>评测/Evals</td>
              <td style={{ padding: '8px 12px', border: '1px solid #e5e7eb', color: '#6b7280' }}>LangSmith Evals</td>
              <td style={{ padding: '8px 12px', border: '1px solid #e5e7eb', color: '#d97706' }}>agent-eval.ts(in-memory, 无数据集管理)</td>
              <td style={{ padding: '8px 12px', border: '1px solid #e5e7eb' }}><span style={{ background: '#fef3c7', color: '#92400e', padding: '1px 6px', borderRadius: 3, fontSize: 11 }}>部分</span></td>
            </tr>
            <tr>
              <td style={{ padding: '8px 12px', border: '1px solid #e5e7eb' }}>Prompt 版本管理</td>
              <td style={{ padding: '8px 12px', border: '1px solid #e5e7eb', color: '#6b7280' }}>Coze 提示词库</td>
              <td style={{ padding: '8px 12px', border: '1px solid #e5e7eb', color: '#6b7280' }}>skills/SKILL.md 静态模板，无版本化</td>
              <td style={{ padding: '8px 12px', border: '1px solid #e5e7eb' }}><span style={{ background: '#fee2e2', color: '#991b1b', padding: '1px 6px', borderRadius: 3, fontSize: 11 }}>缺</span></td>
            </tr>
            <tr>
              <td style={{ padding: '8px 12px', border: '1px solid #e5e7eb' }}>数据 Pipeline</td>
              <td style={{ padding: '8px 12px', border: '1px solid #e5e7eb', color: '#6b7280' }}>LangChain RetrievalQA</td>
              <td style={{ padding: '8px 12px', border: '1px solid #e5e7eb', color: '#d97706' }}>data-gateway(连接层) + knowledge(chunker)</td>
              <td style={{ padding: '8px 12px', border: '1px solid #e5e7eb' }}><span style={{ background: '#fef3c7', color: '#92400e', padding: '1px 6px', borderRadius: 3, fontSize: 11 }}>部分</span></td>
            </tr>
            <tr>
              <td style={{ padding: '8px 12px', border: '1px solid #e5e7eb' }}>人工审核(HITL)</td>
              <td style={{ padding: '8px 12px', border: '1px solid #e5e7eb', color: '#6b7280' }}>Coze 人审节点</td>
              <td style={{ padding: '8px 12px', border: '1px solid #e5e7eb', color: '#059669' }}>有 — interaction.requested 事件 + human-approval-queue.ts</td>
              <td style={{ padding: '8px 12px', border: '1px solid #e5e7eb' }}><span style={{ background: '#d1fae5', color: '#065f46', padding: '1px 6px', borderRadius: 3, fontSize: 11 }}>已有</span></td>
            </tr>
          </tbody>
        </table>
      </section>

      {/* Summary */}
      <section style={{ background: '#f9fafb', borderRadius: 10, padding: '20px 24px', border: '1px solid #e5e7eb' }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>总结</h2>
        <p style={{ color: '#374151', margin: '0 0 12px', fontSize: 14 }}>
          DataFoundry 的 <strong>Agent Runtime 基础设施</strong>(Orchestrator/SubAgent/GoalRunner/HITL/MCP) 已相对完善，核心缺失在于<strong>上层应用层</strong>。
        </p>
        <ul style={{ color: '#6b7280', fontSize: 14, margin: 0, paddingLeft: 20 }}>
          <li>职责 1(数据策略): 完全缺失，无 UI + 无 SOP 管理</li>
          <li>职责 2(工作流建设): 基础有(P0)，缺可视化编辑器(P1)、Prompt 版本管理(P3)</li>
          <li>职责 3(评测闭环): 部分有(agent-eval.ts)，缺持久化 + 业务评测集 + 反馈环(P0 优先级最高)</li>
        </ul>
        <p style={{ color: '#9ca3af', fontSize: 13, marginTop: 12, marginBottom: 0 }}>
          建议从 P0(评测集持久化 + 业务评测集)开始，因其是"评测-数据-模型"闭环的数据底座，也是其他功能( Prompt 迭代、数据策略)的输入来源。
        </p>
      </section>

    </div>
  )
}
