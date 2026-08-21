/**
 * 配置：worker 启动时载入，全部来自环境变量。
 * 仓库范式：12-factor，禁止硬编码连接串。
 */

export interface WorkerConfig {
  supabaseUrl: string;
  serviceRoleKey: string;
  /** 轮询间隔（毫秒），默认 800ms */
  pollIntervalMs: number;
  /** 单次拿的事件数，控制并发 */
  batchSize: number;
  /** 投递超时（毫秒） */
  httpTimeoutMs: number;
  /** 钉钉 webhook 前缀 URL，可选 */
  defaultDingtalkBase: string;
  /** 模拟模式：true → 不真发 POST，只记日志 */
  dryRun: boolean;
}

export function loadConfig(): WorkerConfig {
  const requireEnv = (key: string): string => {
    const v = process.env[key];
    if (!v) throw new Error(`missing env: ${key}`);
    return v;
  };

  return {
    supabaseUrl: requireEnv("SUPABASE_URL"),
    serviceRoleKey: requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    pollIntervalMs: Number(process.env.POLL_INTERVAL_MS ?? 800),
    batchSize: Number(process.env.BATCH_SIZE ?? 5),
    httpTimeoutMs: Number(process.env.HTTP_TIMEOUT_MS ?? 5_000),
    defaultDingtalkBase:
      process.env.DINGTALK_BASE_URL ?? "https://oapi.dingtalk.com",
    dryRun: (process.env.DRY_RUN ?? "false").toLowerCase() === "true",
  };
}
