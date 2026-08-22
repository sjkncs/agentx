/**
 * Event Analytics - 事件分析和统计工具
 * 
 * 提供对 Session Event Log 的高级分析和统计功能
 */

import type { SessionEvent, StepStats } from "./event-log.js";

/**
 * 事件分析配置
 */
export interface EventAnalyticsConfig {
  /** 分析的事件类型 */
  eventTypes?: string[];
  /** 时间范围 */
  timeRange?: {
    start: number;
    end: number;
  };
}

/**
 * 工具使用统计
 */
export interface ToolUsageStats {
  toolName: string;
  totalCalls: number;
  successCalls: number;
  failedCalls: number;
  averageDuration: number;
  totalDuration: number;
}

/**
 * LLM 使用统计
 */
export interface LLMUsageStats {
  totalCalls: number;
  totalTokens: number;
  averageTokensPerCall: number;
  totalDuration: number;
  averageDurationPerCall: number;
}

/**
 * Turn 统计
 */
export interface TurnStats {
  totalTurns: number;
  successfulTurns: number;
  failedTurns: number;
  partialTurns: number;
  averageDuration: number;
  totalDuration: number;
}

/**
 * Step 统计
 */
export interface StepStatsSummary {
  totalSteps: number;
  averageToolCallsPerStep: number;
  averageErrorsPerStep: number;
  averageDuration: number;
  longestStep: StepStats | null;
}

/**
 * 会话分析结果
 */
export interface SessionAnalytics {
  /** 会话ID */
  sessionId: string;
  /** 分析时间范围 */
  timeRange: {
    start: number;
    end: number;
    duration: number;
  };
  /** 事件统计 */
  eventCounts: Record<string, number>;
  /** 工具使用统计 */
  toolUsage: ToolUsageStats[];
  /** Turn 统计 */
  turnStats: TurnStats;
  /** Step 统计 */
  stepStats: StepStatsSummary;
  /** 错误分析 */
  errorAnalysis: {
    totalErrors: number;
    errorsByTool: Record<string, number>;
    errorsByType: Record<string, number>;
  };
  /** Human-in-the-loop 统计 */
  humanInteraction: {
    totalAsks: number;
    totalAnswers: number;
    totalTimeouts: number;
  };
  /** 上下文统计 */
  contextStats: {
    totalCompactions: number;
    totalInjections: number;
    averageTokensBeforeCompact: number;
    averageTokensAfterCompact: number;
  };
}

/**
 * Event Analytics - 事件分析工具
 */
export class EventAnalytics {
  /**
   * 分析会话事件
   */
  static analyze(
    events: (SessionEvent & { _seq?: number; _timestamp?: number })[],
    config?: EventAnalyticsConfig
  ): SessionAnalytics {
    // 过滤事件
    let filteredEvents = events;
    
    if (config?.eventTypes) {
      filteredEvents = events.filter((e) =>
        config.eventTypes!.includes(e.type)
      );
    }
    
    if (config?.timeRange) {
      filteredEvents = filteredEvents.filter(
        (e) =>
          (e._timestamp || 0) >= config.timeRange!.start &&
          (e._timestamp || 0) <= config.timeRange!.end
      );
    }
    
    // 计算时间范围
    const timestamps = filteredEvents
      .map((e) => e._timestamp || 0)
      .filter((t) => t > 0);
    const start = Math.min(...timestamps);
    const end = Math.max(...timestamps);
    
    // 统计事件数量
    const eventCounts: Record<string, number> = {};
    for (const event of filteredEvents) {
      eventCounts[event.type] = (eventCounts[event.type] || 0) + 1;
    }
    
    // 工具使用统计
    const toolUsage = this.calculateToolUsage(filteredEvents);
    
    // Turn 统计
    const turnStats = this.calculateTurnStats(filteredEvents);
    
    // Step 统计
    const stepStats = this.calculateStepStats(filteredEvents);
    
    // 错误分析
    const errorAnalysis = this.analyzeErrors(filteredEvents);
    
    // Human-in-the-loop 统计
    const humanInteraction = this.calculateHumanInteraction(filteredEvents);
    
    // 上下文统计
    const contextStats = this.calculateContextStats(filteredEvents);
    
    return {
      sessionId: (events[0] as { _sessionId?: string })?._sessionId || "unknown",
      timeRange: {
        start,
        end,
        duration: end - start,
      },
      eventCounts,
      toolUsage,
      turnStats,
      stepStats,
      errorAnalysis,
      humanInteraction,
      contextStats,
    };
  }
  
  /**
   * 计算工具使用统计
   */
  private static calculateToolUsage(
    events: (SessionEvent & { _seq?: number; _timestamp?: number })[]
  ): ToolUsageStats[] {
    const toolData: Record<
      string,
      {
        calls: number;
        successes: number;
        failures: number;
        durations: number[];
      }
    > = {};
    
    for (const event of events) {
      if (event.type === "tool/call") {
        const toolName = event.toolName;
        if (!toolData[toolName]) {
          toolData[toolName] = {
            calls: 0,
            successes: 0,
            failures: 0,
            durations: [],
          };
        }
        toolData[toolName].calls++;
      } else if (event.type === "tool/result") {
        const toolName = event.toolName;
        if (toolData[toolName]) {
          toolData[toolName].successes++;
          toolData[toolName].durations.push(event.duration);
        }
      } else if (event.type === "tool/error") {
        const toolName = event.toolName;
        if (toolData[toolName]) {
          toolData[toolName].failures++;
        }
      }
    }
    
    return Object.entries(toolData)
      .map(([toolName, data]) => ({
        toolName,
        totalCalls: data.calls,
        successCalls: data.successes,
        failedCalls: data.failures,
        averageDuration:
          data.durations.length > 0
            ? data.durations.reduce((a, b) => a + b, 0) / data.durations.length
            : 0,
        totalDuration: data.durations.reduce((a, b) => a + b, 0),
      }))
      .sort((a, b) => b.totalCalls - a.totalCalls);
  }
  
  /**
   * 计算 Turn 统计
   */
  private static calculateTurnStats(
    events: (SessionEvent & { _seq?: number; _timestamp?: number })[]
  ): TurnStats {
    const turnStarts: Record<string, number> = {};
    const turnEnds: Record<
      string,
      { timestamp: number; outcome: string; duration?: number }
    > = {};
    
    for (const event of events) {
      if (event.type === "turn/start") {
        turnStarts[event.turnId] = event._timestamp || 0;
      } else if (event.type === "turn/end") {
        const startTime = turnStarts[event.turnId] || 0;
        turnEnds[event.turnId] = {
          timestamp: event._timestamp || 0,
          outcome: event.outcome,
          duration: event.duration || (event._timestamp || 0) - startTime,
        };
      }
    }
    
    const turns = Object.entries(turnEnds);
    let totalDuration = 0;
    let successfulTurns = 0;
    let failedTurns = 0;
    let partialTurns = 0;
    
    for (const [, data] of turns) {
      totalDuration += data.duration || 0;
      if (data.outcome === "success") successfulTurns++;
      else if (data.outcome === "failure") failedTurns++;
      else if (data.outcome === "partial") partialTurns++;
    }
    
    return {
      totalTurns: turns.length,
      successfulTurns,
      failedTurns,
      partialTurns,
      averageDuration: turns.length > 0 ? totalDuration / turns.length : 0,
      totalDuration,
    };
  }
  
  /**
   * 计算 Step 统计
   */
  private static calculateStepStats(
    events: (SessionEvent & { _seq?: number; _timestamp?: number })[]
  ): StepStatsSummary {
    const steps: StepStats[] = [];
    
    for (const event of events) {
      if (event.type === "step/end") {
        steps.push(event.stats);
      }
    }
    
    if (steps.length === 0) {
      return {
        totalSteps: 0,
        averageToolCallsPerStep: 0,
        averageErrorsPerStep: 0,
        averageDuration: 0,
        longestStep: null,
      };
    }
    
    const totalToolCalls = steps.reduce((sum, s) => sum + s.toolCalls, 0);
    const totalErrors = steps.reduce((sum, s) => sum + s.errors, 0);
    const totalDuration = steps.reduce((sum, s) => sum + s.totalDuration, 0);
    const longestStep = steps.reduce((max, s) =>
      s.totalDuration > (max?.totalDuration || 0) ? s : max
    , steps[0]);
    
    return {
      totalSteps: steps.length,
      averageToolCallsPerStep: totalToolCalls / steps.length,
      averageErrorsPerStep: totalErrors / steps.length,
      averageDuration: totalDuration / steps.length,
      longestStep,
    };
  }
  
  /**
   * 分析错误
   */
  private static analyzeErrors(
    events: (SessionEvent & { _seq?: number; _timestamp?: number })[]
  ): {
    totalErrors: number;
    errorsByTool: Record<string, number>;
    errorsByType: Record<string, number>;
  } {
    const errorsByTool: Record<string, number> = {};
    const errorsByType: Record<string, number> = {};
    let totalErrors = 0;
    
    for (const event of events) {
      if (event.type === "tool/error") {
        totalErrors++;
        errorsByTool[event.toolName] = (errorsByTool[event.toolName] || 0) + 1;
        
        // 尝试从错误消息中提取错误类型
        const errorType = this.extractErrorType(event.error);
        errorsByType[errorType] = (errorsByType[errorType] || 0) + 1;
      }
    }
    
    return {
      totalErrors,
      errorsByTool,
      errorsByType,
    };
  }
  
  /**
   * 从错误消息中提取错误类型
   */
  private static extractErrorType(error: string): string {
    if (error.includes("timeout")) return "timeout";
    if (error.includes("permission")) return "permission";
    if (error.includes("not found")) return "not_found";
    if (error.includes("invalid")) return "invalid_input";
    if (error.includes("network")) return "network";
    return "unknown";
  }
  
  /**
   * 计算 Human-in-the-loop 统计
   */
  private static calculateHumanInteraction(
    events: (SessionEvent & { _seq?: number; _timestamp?: number })[]
  ): {
    totalAsks: number;
    totalAnswers: number;
    totalTimeouts: number;
  } {
    let totalAsks = 0;
    let totalAnswers = 0;
    let totalTimeouts = 0;
    
    for (const event of events) {
      if (event.type === "human/ask") totalAsks++;
      else if (event.type === "human/answer") totalAnswers++;
      else if (event.type === "human/timeout") totalTimeouts++;
    }
    
    return {
      totalAsks,
      totalAnswers,
      totalTimeouts,
    };
  }
  
  /**
   * 计算上下文统计
   */
  private static calculateContextStats(
    events: (SessionEvent & { _seq?: number; _timestamp?: number })[]
  ): {
    totalCompactions: number;
    totalInjections: number;
    averageTokensBeforeCompact: number;
    averageTokensAfterCompact: number;
  } {
    let totalCompactions = 0;
    let totalInjections = 0;
    let beforeTokens = 0;
    let afterTokens = 0;
    let compactCount = 0;
    
    for (const event of events) {
      if (event.type === "context/compact") {
        totalCompactions++;
        beforeTokens += event.beforeTokens;
        afterTokens += event.afterTokens;
        compactCount++;
      } else if (event.type === "context/inject") {
        totalInjections++;
      }
    }
    
    return {
      totalCompactions,
      totalInjections,
      averageTokensBeforeCompact:
        compactCount > 0 ? beforeTokens / compactCount : 0,
      averageTokensAfterCompact:
        compactCount > 0 ? afterTokens / compactCount : 0,
    };
  }
}

/**
 * 生成分析报告
 */
export function generateAnalyticsReport(analytics: SessionAnalytics): string {
  const lines: string[] = [];
  
  lines.push("=".repeat(60));
  lines.push("Session Analytics Report");
  lines.push("=".repeat(60));
  lines.push("");
  
  lines.push(`Session ID: ${analytics.sessionId}`);
  lines.push(
    `Duration: ${(analytics.timeRange.duration / 1000).toFixed(2)}s`
  );
  lines.push("");
  
  lines.push("-".repeat(40));
  lines.push("Turn Statistics");
  lines.push("-".repeat(40));
  lines.push(`Total Turns: ${analytics.turnStats.totalTurns}`);
  lines.push(
    `Successful: ${analytics.turnStats.successfulTurns} (${((analytics.turnStats.successfulTurns / analytics.turnStats.totalTurns) * 100).toFixed(1)}%)`
  );
  lines.push(`Failed: ${analytics.turnStats.failedTurns}`);
  lines.push(`Partial: ${analytics.turnStats.partialTurns}`);
  lines.push(
    `Average Duration: ${(analytics.turnStats.averageDuration / 1000).toFixed(2)}s`
  );
  lines.push("");
  
  lines.push("-".repeat(40));
  lines.push("Step Statistics");
  lines.push("-".repeat(40));
  lines.push(`Total Steps: ${analytics.stepStats.totalSteps}`);
  lines.push(
    `Average Tool Calls per Step: ${analytics.stepStats.averageToolCallsPerStep.toFixed(2)}`
  );
  lines.push(
    `Average Errors per Step: ${analytics.stepStats.averageErrorsPerStep.toFixed(2)}`
  );
  lines.push(
    `Average Duration: ${(analytics.stepStats.averageDuration / 1000).toFixed(2)}s`
  );
  lines.push("");
  
  lines.push("-".repeat(40));
  lines.push("Tool Usage (Top 10)");
  lines.push("-".repeat(40));
  for (const tool of analytics.toolUsage.slice(0, 10)) {
    const successRate = (
      (tool.successCalls / tool.totalCalls) *
      100
    ).toFixed(1);
    lines.push(
      `${tool.toolName}: ${tool.totalCalls} calls, ${successRate}% success, avg ${(tool.averageDuration / 1000).toFixed(2)}s`
    );
  }
  lines.push("");
  
  if (analytics.errorAnalysis.totalErrors > 0) {
    lines.push("-".repeat(40));
    lines.push("Error Analysis");
    lines.push("-".repeat(40));
    lines.push(
      `Total Errors: ${analytics.errorAnalysis.totalErrors}`
    );
    lines.push("Errors by Tool:");
    for (const [tool, count] of Object.entries(
      analytics.errorAnalysis.errorsByTool
    )) {
      lines.push(`  ${tool}: ${count}`);
    }
    lines.push("");
  }
  
  lines.push("-".repeat(40));
  lines.push("Human Interaction");
  lines.push("-".repeat(40));
  lines.push(
    `Total Asks: ${analytics.humanInteraction.totalAsks}`
  );
  lines.push(
    `Total Answers: ${analytics.humanInteraction.totalAnswers}`
  );
  lines.push(
    `Total Timeouts: ${analytics.humanInteraction.totalTimeouts}`
  );
  lines.push("");
  
  if (analytics.contextStats.totalCompactions > 0) {
    lines.push("-".repeat(40));
    lines.push("Context Statistics");
    lines.push("-".repeat(40));
    lines.push(
      `Total Compactions: ${analytics.contextStats.totalCompactions}`
    );
    lines.push(
      `Total Injections: ${analytics.contextStats.totalInjections}`
    );
    lines.push("");
  }
  
  lines.push("=".repeat(60));
  
  return lines.join("\n");
}
