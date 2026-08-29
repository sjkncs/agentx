import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { createClient } from "./lib/authenticated-test-client.mjs";

const API_PORT = process.env.API_PORT ?? 8787;
const API_URL = `http://127.0.0.1:${API_PORT}`;

// Start dev:api in background
const child = spawn("npm", ["--workspace", "@agentx/api", "run", "dev"], {
  env: { ...process.env },
  stdio: ["ignore", "pipe", "pipe"]
});

let output = "";
child.stdout.on("data", (chunk) => {
  output += chunk.toString();
});
child.stderr.on("data", (chunk) => {
  output += chunk.toString();
});

try {
  await waitForHealth(API_URL);
  console.log("✓ API started");

  // Get cookies for auth
  const { loginCookie } = await getSessionCookies(API_URL);
  console.log("✓ Logged in as dev2@local.test");

  // Trigger a real agent run via /api/copilotkit
  const response = await fetch(`${API_URL}/api/copilotkit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Cookie": `auth-session=${loginCookie}`,
      Origin: "http://127.0.0.1:3000"
    },
    body: JSON.stringify({
      method: "runAgent",
      messages: [{ role: "user", content: "你好，请介绍一下你自己。" }],
      threadId: `smoke-thread-${Date.now()}`,
      runId: `smoke-run-${Date.now()}`,
      forwardedProps: {}
    })
  });

  if (!response.body) throw new Error("No response body");

  console.log("✓ Starting run...");
  let hasTreeEvents = false;
  
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    const text = decoder.decode(value);
    if (text.includes("tree.")) {
      hasTreeEvents = true;
      console.log(`[🌳 TREE EVENT] ${text.trim()}`);
    }
    if (text.includes("protocol.")) {
      console.log(`[📋 PROTOCOL EVENT] ${text.trim()}`);
    }
  }

  if (!hasTreeEvents) {
    console.log("⚠ No tree.* events captured (run may have been text-only without governed tool calls)");
    console.log("For tree events, try a data question with available datasources: '列出数据源'");
  } else {
    console.log("✅ Live smoke complete! tree.* events verified.");
  }

} finally {
  child.kill("SIGTERM");
}

async function waitForHealth(url) {
  const start = Date.now();
  while (Date.now() - start < 60000) {
    try {
      const res = await fetch(`${url}/healthz`);
      if (res.ok) return;
    } catch {}
    await delay(1000);
  }
  throw new Error("API health check timeout after 60s");
}

async function getSessionCookies(url) {
  const loginUrl = `${url}/api/v1/auth/login`;
  const res = await fetch(loginUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "dev2@local.test", password: "agentx123" })
  });
  const cookie = res.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("Login failed: no set-cookie");
  return { loginCookie: cookie };
}
