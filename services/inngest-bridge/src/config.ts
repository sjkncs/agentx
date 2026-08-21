/**
 * 配置：worker 启动时载入，全部来自环境变量。
 * 仓库范式：12-factor，禁止硬编码连接串。
 */

export interface WorkerConfig {
  supabaseUrl: string;
  serviceRoleKey: string;
  pollIntervalMs: number;
  batchSize: number;
  httpTimeoutMs: number;
  defaultDingtalkBase: string;
  /** 钉钉机器人签名密钥（HMAC-SHA256）；为空则跳过签名 */
  dingtalkRobotSecret: string;
  /** Inngest Cloud signing key（用于校验 webhook 回调签名） */
  inngestSigningKey: string;
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
    dingtalkRobotSecret: process.env.DINGTALK_ROBOT_SECRET ?? "",
    inngestSigningKey: process.env.INNGEST_SIGNING_KEY ?? "",
    dryRun: (process.env.DRY_RUN ?? "false").toLowerCase() === "true",
  };
}
