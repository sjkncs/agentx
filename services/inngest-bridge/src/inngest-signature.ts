/**
 * inngest-signature.ts — Inngest Cloud webhook 签名校验
 *
 * Inngest ISV 模式: X-Inngest-Signature: sha256=<hex>
 * 校验: HMAC-SHA256(key, rawBody) == decoded hex from header
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/** 校验 Inngest webhook 回调签名（ISV 模式） */
export function verifyInngestSignature(
  rawBody: string,
  signatureHeader: string,
  signingKey: string,
): boolean {
  if (!signatureHeader || !signingKey) return false;
  const expected = createHmac("sha256", signingKey).update(rawBody).digest("hex");
  const received = signatureHeader.replace(/^sha256=/, "");
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(received));
  } catch {
    return false;
  }
}
