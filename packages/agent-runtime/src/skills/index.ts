// Skills — declarative, composable unit of agent behavior.
// Inspired by Anthropic Claude Code patterns/:
//   - code-explorer     : deep codebase analysis sub-agent
//   - code-architect    : architecture design sub-agent
//   - code-reviewer     : quality & correctness review sub-agent
//   - feature-dev       : 7-phase guided workflow with human confirmation gates
//
// Skills sit above the protocol FSM layer. They provide natural-language
// guidance and human-in-the-loop gates without modifying core protocol runtime.

export * from "./skill-types.js";
export * from "./skill-registry.js";
export * from "./skill-executor.js";
export * from "./skill-router-bridge.js";
export * from "./markdown-skill.js";
export * from "./anthropic/code-explorer.js";
export * from "./anthropic/code-architect.js";
export * from "./anthropic/code-reviewer.js";
export * from "./anthropic/feature-dev.js";
