import { generateText } from "ai";
import type { LLMAPI } from "@agentx/agent-runtime";

/**
 * Adapts the resolved run's AI-SDK language model into the lightweight LLMAPI
 * contract consumed by LatsRuntime (Reflexion generation + self-evaluation).
 *
 * The model object on the ModelProvider is an AI-SDK chat model, so we reuse the
 * already-configured, authenticated endpoint rather than re-resolving credentials.
 */
export function createLatsLlmApi(modelProvider: {
  model: unknown;
  model_name: string;
}): LLMAPI {
  return {
    async call(prompt, options) {
      const { text } = await generateText({
        model: modelProvider.model as never,
        prompt,
        ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
        ...(options?.maxTokens !== undefined ? { maxTokens: options.maxTokens } : {}),
      });
      return text;
    },
  };
}
