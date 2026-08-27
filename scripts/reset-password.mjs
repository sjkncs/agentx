#!/usr/bin/env node
// Script to reset password for a user
import { hashPassword } from "../apps/api/dist/auth/crypto.js";
import Database from "better-sqlite3";
import { join } from "node:path";

const EMAIL = process.argv[2];
const NEW_PASSWORD = process.argv[3];

if (!EMAIL || !NEW_PASSWORD) {
  console.error("Usage: node scripts/reset-password.mjs <email> <new-password>");
  process.exit(1);
}

if (NEW_PASSWORD.length < 6) {
  console.error("Password must be at least 6 characters");
  process.exit(1);
}

// Try different possible database locations
const possibleDbPaths = [
  "./storage/metadata/workbench.sqlite",
  "./data/metadata/workbench.sqlite",
  "./.data/metadata/workbench.sqlite",
  "./workbench.sqlite"
];

let db = null;
let dbPath = null;

for (const path of possibleDbPaths) {
  try {
    const testDb = new Database(path, { readonly: true });
    testDb.prepare("SELECT 1").get();
    testDb.close();
    dbPath = path;
    break;
  } catch {
    // Try next path
  }
}

if (!dbPath) {
  console.error("Database not found. Make sure the API server has been started at least once.");
  console.error("Tried paths:", possibleDbPaths);
  process.exit(1);
}

console.log(`Using database: ${dbPath}`);

try {
  db = new Database(dbPath, { readonly: false });
  
  // Find user by email
  const user = db.prepare(`
    SELECT id FROM users WHERE lower(email) = lower(?) AND disabled_at IS NULL
  `).get(EMAIL);

  if (!user) {
    console.error(`User not found: ${EMAIL}`);
    db.close();
    process.exit(1);
  }

  console.log(`Found user: ${EMAIL} (${user.id})`);

  // Hash the new password
  const password = await hashPassword(NEW_PASSWORD);

  // Update password
  db.prepare(`
    INSERT OR REPLACE INTO user_password_credentials (user_id, password_hash, password_hash_params)
    VALUES (?, ?, ?)
  `).run(user.id, password.hash, password.params);

  // Update password_updated_at
  db.prepare(`
    UPDATE users SET password_updated_at = ? WHERE id = ?
  `).run(new Date().toISOString(), user.id);

  // Revoke all sessions
  db.prepare(`
    DELETE FROM auth_sessions WHERE user_id = ?
  `).run(user.id);

  console.log(`Password reset successful for: ${EMAIL}`);
  console.log("All sessions have been revoked.");

  db.close();
} catch (error) {
  console.error("Error:", error.message);
  process.exit(1);
}
