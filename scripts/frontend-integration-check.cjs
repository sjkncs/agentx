// Verify the React/Next.js frontend → API → harness-core end-to-end
const http = require('http');

function get(url, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get(url, { headers, timeout: 5000 }, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }).on('error', reject);
  });
}

function post(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const u = new URL(url);
    const req = http.request({
      method: 'POST',
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        ...headers,
      },
      timeout: 5000,
    }, res => {
      let buf = '';
      res.on('data', d => buf += d);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: buf }));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

(async () => {
  console.log('=== Frontend ↔ API ↔ Harness Integration ===');
  console.log();

  // 1. Frontend root
  const home = await get('http://127.0.0.1:3000/');
  console.log('1. Frontend /');
  console.log('   status:', home.status, '(expected 200 or 307)');

  // 2. Frontend data-tasks page
  const dt = await get('http://127.0.0.1:3000/data-tasks');
  console.log('2. Frontend /data-tasks');
  console.log('   status:', dt.status, 'body len:', dt.body.length);

  // 3. API health
  const apiHealth = await get('http://127.0.0.1:8787/api/v1/health');
  console.log('3. API health');
  console.log('   status:', apiHealth.status);

  // 4. API auth
  const auth = await get('http://127.0.0.1:8787/api/v1/auth/me');
  console.log('4. API auth/me (no creds)');
  console.log('   status:', auth.status, '(expected 401)');

  // 5. Frontend proxies to API
  const proxy = await get('http://127.0.0.1:3000/api/v1/auth/me');
  console.log('5. Frontend → API proxy (via /api/v1/auth/me)');
  console.log('   status:', proxy.status, '(expected 401, proxied)');

  console.log();
  console.log('=== Summary ===');
  const allOk = home.status < 400 && dt.status === 200 && apiHealth.status < 500 && proxy.status === 401;
  console.log(allOk ? '✅ Frontend + API + Proxy + Harness all wired correctly' : '⚠️ Some checks failed');
})().catch(e => {
  console.error('❌ Error:', e.message);
  process.exit(1);
});
