/**
 * AgentX Desktop — Renderer
 *
 * Pure DOM logic. Communicates with the main process via window.dfd (preload).
 */
const $ = (id) => document.getElementById(id);
const $$ = (sel) => document.querySelectorAll(sel);

// ----- Tabs -----
$$('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    const id = btn.dataset.tab;
    $$('.tab').forEach((b) => b.classList.toggle('active', b === btn));
    $$('.tab-content').forEach((s) => s.classList.toggle('active', s.id === `tab-${id}`));
  });
});

// ----- App info refresh -----
async function refreshInfo() {
  const info = await window.dfd.getInfo();
  $('status-text').textContent = `Electron ${info.electron} · Node ${info.node} · API :${info.apiPort ?? '—'}`;
  $('status-dot').className = 'dot ' + (info.apiPort ? 'ok' : 'warn');

  const app_ = $('info-app');
  app_.innerHTML = '';
  [['name', info.name], ['version', info.version], ['userData', info.userData], ['cwd', info.cwd]]
    .forEach(([k, v]) => {
      app_.innerHTML += `<dt>${k}</dt><dd>${v ?? '—'}</dd>`;
    });

  const api_ = $('info-api');
  api_.innerHTML = '';
  [['electron', info.electron], ['chrome', info.chrome], ['node', info.node],
    ['apiPort', info.apiPort], ['apiUrl', info.apiUrl]].forEach(([k, v]) => {
    api_.innerHTML += `<dt>${k}</dt><dd>${v ?? '—'}</dd>`;
  });

  // Wire up web-frame if API is up
  if (info.apiUrl) {
    const frame = $('web-frame');
    if (frame.src !== info.apiUrl) {
      frame.src = info.apiUrl;
      $('web-fallback').style.display = 'none';
    }
  } else {
    $('web-frame').style.display = 'none';
    $('web-frame-status').textContent =
      'API server not started. Check .run/desktop/api.log for details. The CDL Panel and Status tab still work (they do not need the API server). For the full Web workbench, run `npm run start:api` in a separate terminal.';
  }
}

$('btn-logs').addEventListener('click', () => window.dfd.openLogs());
$('btn-repo').addEventListener('click', () => window.dfd.openRepo());
$('btn-restart').addEventListener('click', () => window.dfd.restart());

// ----- CDL panel -----
// The fork (regime-conditional α) is computed in the main process via
// @agentx/counterfactual; the renderer only displays the result.
$('cdl-run').addEventListener('click', async () => {
  const regime = $('cdl-regime').value;
  const phiSem = parseFloat($('cdl-phi-sem').value);
  const phiCf = parseFloat($('cdl-phi-cf').value);
  const uSem = parseFloat($('cdl-u-sem').value);
  const uCf = parseFloat($('cdl-u-cf').value);
  const btn = $('cdl-run');
  const out = $('theorem3-out');
  btn.disabled = true;
  out.textContent = 'Computing fork…';
  try {
    const res = await window.dfd.cdl.run({ regime, phiSem, phiCf, uSem, uCf });
    if (!res?.ok) {
      out.textContent = `CDL unavailable: ${res?.error || 'unknown error'}`;
      return;
    }
    const { alpha, u, J, theorem3 } = res.result;
    $('cdl-alpha').textContent = (alpha ?? 0).toFixed(2);
    $('cdl-u').textContent = (u ?? 0).toFixed(4);
    $('cdl-j').textContent = (J ?? 0).toFixed(4);
    out.textContent =
      `regime-conditional α fork:  ${alpha.toFixed(2)}\n` +
      `u = α·u_sem + (1-α)·u_cf: ${u.toFixed(4)}\n` +
      `J = α·φ_sem + (1-α)·φ_cf:  ${J.toFixed(4)}\n` +
      (theorem3
        ? `✓ Regime-conditional strictly dominates (Theorem 3).`
        : `! Uniform not dominated in this sample.`);
  } catch (err) {
    out.textContent = `CDL error: ${err.message || err}`;
  } finally {
    btn.disabled = false;
  }
});

// Auto-poll every 5s
refreshInfo();
setInterval(refreshInfo, 5_000);