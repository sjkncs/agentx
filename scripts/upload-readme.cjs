const { readFileSync } = require("node:fs");
const { execSync } = require("node:child_process");

const readmeContent = readFileSync("README.md", "utf8");
const contentBase64 = Buffer.from(readmeContent, "utf8").toString("base64");

// Get SHA of current README
const sha = execSync(`gh api repos/sjkncs/agentx/contents/README.md --jq .sha`, { encoding: "utf8" }).trim();
console.log("Current README SHA:", sha);

const body = JSON.stringify({
  message: "docs: rebrand README to AgentX",
  content: contentBase64,
  sha: sha
});

const result = execSync(`gh api -X PUT repos/sjkncs/agentx/contents/README.md --input -`, {
  encoding: "utf8",
  input: body
});
console.log("Upload result:", result.substring(0, 200));