/**
 * Data Analysis Domain Planner Skill.
 *
 * A declarative Skill definition for the data-analysis workflow:
 *   1. Scope       → identify datasource, inspect schema
 *   2. Grounding    → resolve semantic context, ground analysis contract
 *   3. Planning     → write + validate SQL query
 *   4. Execution    → run validated SQL (read-only), capture artifact
 *   5. Validation   → bind evidence, commit requirements
 *   6. Human Review → approval gate before synthesis
 *   7. Synthesis    → produce final answer with evidence citations
 *
 * This skill gives the LLM an explicit phase plan with human gates,
 * complementing the data-analysis protocol FSM which is the runtime state machine.
 *
 * Wire Phase 5.7 (Human Approval) by connecting humanGate phases to
 * the human-approval-queue.ts store so admins see pending reviews at
 * /admin/approvals.
 */
import type { SkillDefinition } from "./skill-types.js";

export const dataAnalysisSkill: SkillDefinition = {
  id: "data-analysis-planner",
  version: "1",
  displayName: "Data Analysis Planner",
  description:
    "Decomposes a data analysis question into scope → grounding → planning → execution → " +
    "validation → human approval → synthesis. Use for: metric analysis, report generation, " +
    "cohort analysis, funnel analysis, multi-table joins, KPI tracking, data quality checks.",
  invocationPattern: "/analyze {question}",
  tags: ["workflow", "data-analysis", "human-in-the-loop", "sql"],
  protocolHandoffs: ["general-task"],

  phases: [
    {
      id: "scope",
      name: "Scope & Schema Discovery",
      goal:
        "Identify the target datasource and inspect its schema. " +
        "Call list_data_sources, then inspect_schema. Never write SQL without a valid schema grounding.",
      humanGate: false,
      allowedActions: ["list_data_sources", "inspect_schema", "preview_table"],
      transitions: [
        { targetPhase: "grounding", when: "schema_inspected" },
      ],
    },
    {
      id: "grounding",
      name: "Semantic & Contract Grounding",
      goal:
        "Resolve the semantic context and ground the analysis contract. " +
        "Call semantic.context.resolve and analysis.contract.ground. " +
        "Surface any semantic warnings to the user.",
      humanGate: false,
      allowedActions: [
        "inspect_schema", "preview_table",
        "semantic.context.resolve", "analysis.contract.ground",
        "analysis.requirements.commit",
      ],
      transitions: [
        { targetPhase: "planning", when: "semantic_resolved AND contract_grounded" },
      ],
    },
    {
      id: "planning",
      name: "Query Planning & Validation",
      goal:
        "Write a read-only SELECT query, then validate it against the schema. " +
        "Call data.query.plan then data.query.validate. " +
        "Fix errors and re-validate until clean.",
      humanGate: false,
      allowedActions: [
        "inspect_schema", "preview_table",
        "semantic.context.resolve",
        "data.query.plan", "data.query.validate",
      ],
      transitions: [
        { targetPhase: "execution", when: "current_query_validated" },
      ],
    },
    {
      id: "execution",
      name: "Query Execution",
      goal:
        "Execute the validated read-only query via run_sql_readonly. " +
        "Capture the artifact_id. If execution fails, return to planning.",
      humanGate: false,
      allowedActions: [
        "inspect_schema", "preview_table",
        "run_sql_readonly", "data.query.plan",
        "semantic.context.resolve",
      ],
      transitions: [
        { targetPhase: "validation", when: "query_executed" },
      ],
    },
    {
      id: "validation",
      name: "Evidence Binding & Requirement Commit",
      goal:
        "Validate results, bind evidence to requirements, and commit claims. " +
        "Call analysis.result.validate, analysis.evidence.bind, analysis.requirements.commit. " +
        "Then request human confirmation before synthesis.",
      humanGate: true,
      allowedActions: [
        "preview_table", "data.query.plan",
        "analysis.result.validate", "analysis.evidence.bind",
        "analysis.requirements.commit",
      ],
      transitions: [
        { targetPhase: "human_review", when: "human_confirmed" },
        { targetPhase: "planning", when: "validation_error" },
      ],
    },
    {
      id: "human_review",
      name: "Human Approval Gate",
      goal:
        "Display validated findings and wait for explicit human approval. " +
        "If 'approved' → synthesis. If 'revised' → return to planning with feedback. " +
        "If 'rejected' → terminate gracefully.",
      humanGate: true,
      allowedActions: [
        "human.confirmation.granted", "human.confirmation.revised",
      ],
      transitions: [
        { targetPhase: "synthesis", when: "human_confirmed:approved" },
        { targetPhase: "planning", when: "human_confirmed:revised" },
      ],
    },
    {
      id: "synthesis",
      name: "Final Synthesis & Delivery",
      goal:
        "Write a clear, evidenced answer: (1) answer the original question directly, " +
        "(2) cite specific artifact evidence, (3) note caveats, " +
        "(4) match the requested format. Then call general.answer.commit.",
      humanGate: false,
      allowedActions: [
        "inspect_schema", "preview_table",
        "analysis.result.validate", "analysis.evidence.bind",
        "analysis.requirements.commit", "general.answer.commit",
      ],
      transitions: [
        { targetPhase: "end", when: "answer_committed" },
      ],
    },
  ],
};
