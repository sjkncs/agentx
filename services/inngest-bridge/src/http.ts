/** POST with abort + timeout. Returns status/text/ok; never throws. */
export async function post(
  url: string,
  body: string,
  timeoutMs: number,
): Promise<{ status: number; text: string; ok: boolean }> {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      signal: ctrl.signal,
    });
    const text = await res.text();
    return { status: res.status, text, ok: res.ok };
  } catch (err) {
    return {
      status: 0,
      text: err instanceof Error ? err.message : String(err),
      ok: false,
    };
  } finally {
    clearTimeout(to);
  }
}
