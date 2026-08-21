/**
 * dingtalk-signature.ts — 钉钉自定义机器人 HMAC-SHA256 签名
 *
 * 钉钉协议: sign = base64(HMAC-SHA256(secret, timestamp + "\n" + random))
 * URL 格式: https://oapi.dingtalk.com/robot/send?access_token=...&timestamp=...&sign=...
 *
 * 用法:
 *   const signed = addDingtalkSign(url, process.env.DINGTALK_ROBOT_SECRET);
 *   const res = await fetch(signed, { method: "POST", body: reqJson });
 */
import { createHmac } from "node:crypto";

/** 生成带签名的钉钉 webhook URL（timestamp + sign query params） */
export function signDingtalkUrl(webhookUrl: string, secret: string): string {
  const timestamp = Date.now().toString();
  const signStr = `${timestamp}\n${secret}`;
  const sign = createHmac("sha256", secret)
    .update(signStr)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
  const sep = webhookUrl.includes("?") ? "&" : "?";
  return `${webhookUrl}${sep}timestamp=${timestamp}&sign=${encodeURIComponent(sign)}`;
}

/** fetch body 中是否需要额外 headers（DingTalk 签名不需要额外 header，签名在 URL 中） */
export function dingtalkHeaders(token: string): Record<string, string> {
  return { "content-type": "application/json" };
}
