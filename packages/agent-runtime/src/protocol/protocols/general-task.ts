import type { AgentProtocolDefinition } from "../types.js";

const DATA_ACTIONS = new Set(["list_data_sources", "inspect_schema", "preview_table", "run_sql_readonly"]);

export type GeneralTaskState = {
  answerMessageId?: string;
  /** Tracks whether the agent has surfaced clarifying questions to the human. */
  clarifyingQuestionsRaised?: boolean;
  /** Human's response to clarifying questions — undefined until answered. */
  clarifyingQuestionsAnswered?: boolean;
  /** Summary of human answers to clarifying questions. */
  clarifyingAnswersSummary?: string | undefined;
  /** Whether a pre-commit human review was requested. */
  preCommitReviewRequested?: boolean;
  /** Human's pre-commit approval decision. */
  preCommitApproval?: "approved" | "rejected" | "revised";
  /** Optional human comment on the approval. */
  preCommitComment?: string | undefined;
};

export const createGeneralTaskProtocol = (
  availableActionNames: string[]
): AgentProtocolDefinition<GeneralTaskState> => {
  const workActions = [
    ...availableActionNames.filter((actionName) => !DATA_ACTIONS.has(actionName)),
    "protocol.handoff.propose",
    "general.answer.commit",
    "general.clarifying.questions",
    "general.human.confirmation.request"
  ];

  const reviewActions = [
    ...workActions,
    "general.human.confirmation.granted",
    "general.human.confirmation.revised"
  ];

  return {
    id: "general-task",
    version: "2",
    initialPhase: "understand",
    phases: {
      /** Phase 1 — Understand: agent gathers context and identifies gaps. */
      understand: {
        guidance:
          "Understand the request before acting. Restate the goal, identify what is missing or ambiguous, "
          + "and decide whether you can proceed, need to ask the user, or need to gather more context. "
          + "If anything is unclear, raise clarifying questions rather than guessing.",
        allowedActions: workActions,
        transitions: [
          {
            targetPhase: "clarify",
            when: ({ actionName }) => actionName === "general.clarifying.questions"
          },
          {
            targetPhase: "gather",
            when: ({ actionName }) =>
              actionName !== "general.clarifying.questions" && actionName !== "general.answer.commit"
          },
          {
            targetPhase: "pre_commit_review",
            when: ({ actionName }) => actionName === "general.answer.commit"
          }
        ]
      },
      /** Phase 2 — Clarify: agent presents clarifying questions to human and waits.
       *  Mirrors feature-dev Phase 3 (Clarifying Questions). */
      clarify: {
        guidance:
          "Ask the user focused clarifying questions to resolve ambiguity before doing the work. "
          + "Keep questions short and specific, then wait for the answers. Do not proceed to the main "
          + "task until the user has responded.",
        allowedActions: workActions,
        transitions: [
          {
            targetPhase: "clarify",
            when: ({ actionName }) => actionName === "general.clarifying.questions"
          },
          {
            targetPhase: "gather",
            when: ({ state }) => state.clarifyingQuestionsAnswered === true
          }
        ]
      },
      /** Phase 3 — Gather: agent performs work actions to build the answer. */
      gather: {
        guidance:
          "Do the actual work now: call the approved tools to gather information, reason over the results, "
          + "and draft the answer. Stay focused on the user's goal. When the answer is ready, request "
          + "pre-commit review instead of finalizing silently.",
        allowedActions: workActions,
        transitions: [
          {
            targetPhase: "pre_commit_review",
            when: ({ actionName }) => actionName === "general.answer.commit"
          },
          {
            targetPhase: "clarify",
            when: ({ actionName }) => actionName === "general.clarifying.questions"
          }
        ]
      },
      /** Phase 4 — Pre-commit review: human confirms before answer is committed.
       *  Mirrors feature-dev Phase 6 human gate. */
      pre_commit_review: {
        guidance:
          "Present the drafted answer to the user and wait for explicit confirmation before committing it. "
          + "If the user approves, commit the answer. If they ask for changes or reject it, return to gather "
          + "and revise. Never commit without the user's sign-off.",
        allowedActions: reviewActions,
        transitions: [
          {
            targetPhase: "answer",
            when: ({ actionName, state }) =>
              actionName === "general.human.confirmation.granted" && state.preCommitApproval === "approved"
          },
          {
            targetPhase: "gather",
            when: ({ actionName, state }) =>
              (actionName === "general.human.confirmation.revised" && state.preCommitApproval === "revised") ||
              (actionName === "general.human.confirmation.granted" && state.preCommitApproval === "rejected")
          }
        ]
      },
      /** Phase 5 — Answer: terminal phase, answer is committed. */
      answer: {
        guidance:
          "The answer is committed. Deliver it clearly to the user and stop. Take no further actions in this run.",
        allowedActions: [],
        transitions: []
      }
    },
    createInitialState: () => ({ preCommitReviewRequested: false }),
    completionPolicy: ({ contextPackageRef, state }) => {
      if (state.answerMessageId) {
        return {
          status: "completed",
          evaluatedContextPackageRef: contextPackageRef,
          evidenceRefs: []
        };
      }
      const missing: string[] = [];
      if (!state.answerMessageId) {
        missing.push("GENERAL_ANSWER_NOT_COMMITTED");
      }
      // If in pre_commit_review phase, the human is the gate — don't spam with generic reasons
      if (missing.includes("GENERAL_ANSWER_NOT_COMMITTED")) {
        return {
          status: "continue",
          reasons: missing,
          allowedActions: ["general.answer.commit", "general.human.confirmation.request"]
        };
      }
      return {
        status: "continue",
        reasons: ["GENERAL_ANSWER_NOT_COMMITTED"],
        allowedActions: ["general.answer.commit"]
      };
    }
  };
};

export const reduceGeneralTaskAction = (
  state: GeneralTaskState,
  actionName: string,
  result: unknown
): GeneralTaskState => {
  switch (actionName) {
    case "general.clarifying.questions": {
      const questions = recordStrings(result, "questions");
      const summary = recordString(result, "summary");
      return {
        ...state,
        clarifyingQuestionsRaised: questions.length > 0,
        clarifyingQuestionsAnswered: false,
        clarifyingAnswersSummary: summary,
      };
    }
    case "general.clarifying.questions.answered": {
      return {
        ...state,
        clarifyingQuestionsAnswered: true,
        clarifyingAnswersSummary: recordString(result, "summary"),
      };
    }
    case "general.human.confirmation.request": {
      return {
        ...state,
        preCommitReviewRequested: true,
      };
    }
    case "general.human.confirmation.granted": {
      const approved = recordString(result, "approved");
      return {
        ...state,
        preCommitReviewRequested: false,
        preCommitApproval: approved === "true" || approved === "yes" ? "approved" : "rejected",
        preCommitComment: recordString(result, "comment"),
      };
    }
    case "general.human.confirmation.revised": {
      return {
        ...state,
        preCommitReviewRequested: false,
        preCommitApproval: "revised",
        preCommitComment: recordString(result, "comment"),
      };
    }
    case "general.answer.commit": {
      const messageId = recordString(result, "messageId");
      if (!messageId) {
        // A commit attempt without a message id on protocol-managed state is a
        // pre-commit review request (Anthropic-style human gate). A bare
        // ad-hoc state object indicates the reducer is misused.
        if (state.preCommitReviewRequested === undefined) {
          throw new Error("GENERAL_ANSWER_MESSAGE_MISSING");
        }
        return { ...state, preCommitReviewRequested: true };
      }
      return { ...state, answerMessageId: messageId };
    }
    default:
      return state;
  }
};

const recordString = (value: unknown, key: string): string | undefined => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" && field.length > 0 ? field : undefined;
};

const recordStrings = (value: unknown, key: string): string[] => {
  if (typeof value !== "object" || value === null) return [];
  const field = (value as Record<string, unknown>)[key];
  return Array.isArray(field) ? field.filter((v): v is string => typeof v === "string") : [];
};
