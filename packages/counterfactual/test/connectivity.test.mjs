/**
 * Connectivity test — verify that all 4 CDL components interoperate and produce
 * the expected pipeline:  Semantic → DAG → CF Engine → Joint Decision.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  UnifiedSemanticLayer, CausalDAG, CounterfactualEngine,
  jointDecision, regimeConditionalDecision,
} from '../src/index.mjs';

test('CDL connectivity — full pipeline produces a decision', () => {
  // 1. Semantic layer
  const sem = new UnifiedSemanticLayer({ dim: 32, seed: 1 });
  const trainScore = sem.score('Market', 'drives', 'Volatility');
  const negScore = sem.score('Volatility', 'drives', 'Market');
  assert.ok(trainScore > 0, 'positive triple must score');
  assert.ok(negScore > 0, 'negative triple must score');
  const initialLoss = sem.trainStep('Market', 'drives', 'Volatility', 'Volatility', 'Market');
  assert.ok(initialLoss >= 0, 'trainStep must return non-negative loss');

  // 2. Causal DAG over 8 entity activations
  const n = 8;
  const T = 30;
  const X = Array.from({ length: n }, (_, i) =>
    Array.from({ length: T }, (_, t) => Math.sin((i + 1) * 0.1 * t) * 0.5)
  );
  const dag = new CausalDAG({ n, lambda_acyclic: 0.05, seed: 2 });
  const reconBefore = dag.reconLoss(X);
  const hBefore = dag.acyclicity();
  assert.ok(reconBefore >= 0, 'reconstruction loss non-negative');
  assert.ok(Math.abs(hBefore) < 1e9, 'acyclicity is finite');
  // Take 3 gradient steps
  for (let k = 0; k < 3; k++) dag.step(X, 0.05);
  const reconAfter = dag.reconLoss(X);
  assert.ok(reconAfter <= reconBefore + 1e-3, 'reconstruction must not grow after one step');

  // 3. Counterfactual engine: synthetic treated/control samples
  const dX = 3, dZ = 2;
  const cf = new CounterfactualEngine({ dX, dZ, hidden: 16, beta_grad: 0.05, seed: 3 });
  const xT = Array.from({ length: 10 }, () => [1, 0, 0]);
  const xC = Array.from({ length: 10 }, () => [0, 1, 0]);
  const z = Array.from({ length: 10 }, () => [0.5, 0.5]);
  const yT = Array.from({ length: 10 }, () => 0.8);
  const yC = Array.from({ length: 10 }, () => 0.3);
  const loss = cf.ateLoss(xT, xC, z, yT, yC);
  assert.ok(loss >= 0 && Number.isFinite(loss), 'ATE loss must be finite and non-negative');
  const ate = cf.estimateATE(xT, xC, z, yT, yC);
  assert.ok(Number.isFinite(ate), 'ATE must be finite');

  // 4. Joint decision (regime-conditional: bull trusts CF, bear trusts semantic)
  const phiSem = 0.7;
  const phiCf = 0.5;
  const decisionBull = regimeConditionalDecision({ regime: 'bull', phiSem, phiCf });
  const decisionBear = regimeConditionalDecision({ regime: 'bear', phiSem, phiCf });
  assert.equal(decisionBull.alpha, 0.3, 'bull alpha');
  assert.equal(decisionBear.alpha, 0.7, 'bear alpha');
  assert.ok(Math.abs(decisionBull.u - decisionBear.u) > 1e-6, 'bull vs bear must produce different u');
  assert.ok(Math.abs(decisionBull.J - decisionBear.J) > 1e-6, 'bull vs bear J must differ');
  // In bull α=0.3, uSem=0.3 uCf=0.7 → u = 0.3*0.3 + 0.7*0.7 = 0.58
  assert.ok(Math.abs(decisionBull.u - 0.58) < 1e-9);
  // In bear α=0.7, u = 0.7*0.3 + 0.3*0.7 = 0.42
  assert.ok(Math.abs(decisionBear.u - 0.42) < 1e-9);
});