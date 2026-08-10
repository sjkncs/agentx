/**
 * Async test — verify that CDL components handle concurrent execution,
 * Promise resolution, and event-loop interactions correctly.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import {
  UnifiedSemanticLayer, CausalDAG, CounterfactualEngine, jointDecision,
} from '../src/index.mjs';

test('CDL async — semantic-layer trains in concurrent loops', async () => {
  const sem = new UnifiedSemanticLayer({ dim: 16, seed: 4 });
  const triples = [
    ['Market', 'drives', 'Volatility', 'Liquidity'],
    ['OrderBook', 'lags', 'Volatility', 'MacroIndicator'],
    ['Regime', 'gates', 'Position', 'Market'],
  ];
  const results = await Promise.all(
    triples.map(async ([h, r, t, neg]) => {
      const losses = [];
      for (let i = 0; i < 10; i++) {
        const loss = sem.trainStep(h, r, t, neg, t);
        losses.push(loss);
        await delay(1);
      }
      return losses;
    }),
  );
  for (const losses of results) {
    assert.equal(losses.length, 10);
    assert.ok(losses.every(l => l >= 0), 'all losses non-negative');
  }
});

test('CDL async — causal DAG + CF engine run concurrently without race', async () => {
  const n = 5;
  const T = 20;
  const X = Array.from({ length: n }, (_, i) =>
    Array.from({ length: T }, (_, t) => Math.cos((i + 1) * 0.2 * t)),
  );
  const dag = new CausalDAG({ n, lambda_acyclic: 0.1, seed: 5 });
  const cf = new CounterfactualEngine({ dX: 2, dZ: 1, hidden: 8, seed: 6 });

  const [dagLoss, cfLoss] = await Promise.all([
    (async () => {
      let last = 0;
      for (let i = 0; i < 5; i++) {
        last = dag.totalLoss(X);
        dag.step(X, 0.02);
        await delay(2);
      }
      return last;
    })(),
    (async () => {
      const xT = [[1, 0], [1, 0.1]];
      const xC = [[0, 1], [0.1, 1]];
      const z = [[0.5], [0.5]];
      const yT = [0.9, 0.85];
      const yC = [0.2, 0.3];
      return cf.ateLoss(xT, xC, z, yT, yC);
    })(),
  ]);
  assert.ok(Number.isFinite(dagLoss) && dagLoss >= 0);
  assert.ok(Number.isFinite(cfLoss) && cfLoss >= 0);
});

test('CDL async — joint decision is synchronous and pure', () => {
  for (let i = 0; i < 1000; i++) {
    const regime = ['bull', 'bear', 'sideways'][i % 3];
    const phiSem = (i % 100) / 100;
    const phiCf = ((i + 37) % 100) / 100;
    const d = jointDecision({ regime, phiSem, phiCf, uSem: 0.5, uCf: 0.5 });
    const alpha = regime === 'bull' ? 0.3 : regime === 'bear' ? 0.7 : 0.5;
    const expected_u = alpha * 0.5 + (1 - alpha) * 0.5;
    assert.ok(Math.abs(d.u - expected_u) < 1e-9, `iteration ${i}: u mismatch ${d.u} vs ${expected_u}`);
  }
});

test('CDL async — concurrent allocation of many engines', async () => {
  const engines = await Promise.all(
    Array.from({ length: 20 }, async (_, i) => {
      const eng = new CounterfactualEngine({ dX: 2, dZ: 1, hidden: 4, seed: i });
      const xT = [[1, 0]];
      const xC = [[0, 1]];
      const z = [[0.5]];
      const yT = [0.5];
      const yC = [0.5];
      await delay(Math.random() * 5);
      return eng.ateLoss(xT, xC, z, yT, yC);
    }),
  );
  for (const l of engines) assert.ok(Number.isFinite(l) && l >= 0);
});