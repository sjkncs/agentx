// Test the Supabase signup API directly
const SUPABASE_URL = "http://127.0.0.1:54321";
const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5NDM2NDI5OTR9.sxwSTfHnAzohvOtk5bIc4JXHPf7V07r8o5WTPjc";

async function testSignUp(email, password) {
  console.log(`\n=== Testing signup for ${email} ===`);
  try {
    const resp = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
      method: "POST",
      headers: {
        apikey: ANON_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password }),
    });
    const data = await resp.json();
    console.log(`HTTP ${resp.status}`);
    if (data?.user?.id) {
      console.log(`user.id=${data.user.id}`);
      console.log(`user.email=${data.user.email}`);
      console.log(`user.email_confirmed_at=${data.user.email_confirmed_at}`);
      console.log(`session.access_token=${data?.session?.access_token?.slice(0, 20)}...`);
    } else {
      console.log("Response:", JSON.stringify(data, null, 2));
    }
  } catch (err) {
    console.error("ERROR:", err.message);
  }
}

async function testSignIn(email, password) {
  console.log(`\n=== Testing sign-in for ${email} ===`);
  try {
    const resp = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: {
        apikey: ANON_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password }),
    });
    const data = await resp.json();
    console.log(`HTTP ${resp.status}`);
    if (data?.access_token) {
      console.log(`access_token=${data.access_token.slice(0, 20)}...`);
      console.log(`expires_in=${data.expires_in}`);
      console.log(`refresh_token=${data.refresh_token?.slice(0, 20)}...`);
      console.log(`user.email_confirmed_at=${data.user?.email_confirmed_at}`);
    } else {
      console.log("Response:", JSON.stringify(data, null, 2));
    }
  } catch (err) {
    console.error("ERROR:", err.message);
  }
}

async function main() {
  const email = "zhiwaisong@gmail.com";
  const password = "TestPass1234!";

  // 1) Try sign-in first (in case account already exists)
  await testSignIn(email, password);

  // 2) Try sign-up
  await testSignUp(email, password);

  // 3) Try sign-in again (in case signup created the user)
  await testSignIn(email, password);
}

main().catch(e => { console.error(e); process.exit(1); });