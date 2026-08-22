// Debug script: Use project's authenticated test client to register
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
const __dirname = dirname(fileURLToPath(import.meta.url));

// Use the project's auth client  
const { createAuthenticatedTestClient } = await import("./lib/authenticated-test-client.mjs");

async function main() {
  const client = createAuthenticatedTestClient({ baseUrl: "http://127.0.0.1:8787" });

  console.log("1. Register and login...");
  const identity = await client.registerAndLogin({ displayName: "Upload Test" });
  console.log("   User:", identity.userId);
  console.log("   Workspace:", identity.workspaceId);
  console.log("   Cookies:", Object.keys(identity.cookies));

  console.log("2. Verify session...");
  const me = await client.fetchJson("/api/v1/me");
  console.log("   Me:", me.body?.data?.user?.id);

  const sessionId = "test-session-" + Date.now();
  console.log("3. Upload with session:", sessionId);

  const form = new FormData();
  form.append("files", new Blob(["# Test Report\n\nContent"], {type: "text/markdown"}), "test.md");
  form.append("sessionId", sessionId);

  const res = await client.fetch("/api/v1/files", {
    method: "POST",
    headers: { "X-Session-Id": sessionId },
    body: form
  });
  const body = await res.json();
  console.log("   Upload status:", res.status);
  console.log("   Upload body:", JSON.stringify(body).slice(0, 200));
}

main().catch(e => console.error("Error:", e));
