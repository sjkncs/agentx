/**
 * Unified Semantic Layer — TransE-style KG embedding for DataFoundry state.
 *
 * Entities:  Market, OrderBook, Position, Regime, Volatility, Liquidity, Fundamental, MacroIndicator
 * Relations: drives, lags, co_volatile_with, intervenes_on, gates, constrains
 *
 * Embedding scoring: f(h, r, t) = ||h + r - t||
 * Margin loss: L = max(0, f(h+,r,t+) - f(h-,r,t-) + γ), γ = 1.0
 */
import crypto from 'node:crypto';

export const DEFAULT_ENTITIES = [
  'Market', 'OrderBook', 'Position', 'Regime',
  'Volatility', 'Liquidity', 'Fundamental', 'MacroIndicator',
];
export const DEFAULT_RELATIONS = [
  'drives', 'lags', 'co_volatile_with', 'intervenes_on', 'gates', 'constrains',
];

export class UnifiedSemanticLayer {
  constructor({ dim = 64, margin = 1.0, seed = 42 } = {}) {
    this.dim = dim;
    this.margin = margin;
    this.entityIdx = new Map(DEFAULT_ENTITIES.map((e, i) => [e, i]));
    this.relationIdx = new Map(DEFAULT_RELATIONS.map((r, i) => [r, i]));
    const rng = crypto.createHash('sha256');
    rng.update(`seed:${seed},dim:${dim}`);
    const seedBuf = rng.digest();
    this.E = new Float32Array(DEFAULT_ENTITIES.length * dim);
    this.R = new Float32Array(DEFAULT_RELATIONS.length * dim);
    for (let i = 0; i < this.E.length; i++) {
      this.E[i] = (seedBuf[i % seedBuf.length] / 255 - 0.5) * 0.1;
    }
    for (let i = 0; i < this.R.length; i++) {
      this.R[i] = (seedBuf[(i + 13) % seedBuf.length] / 255 - 0.5) * 0.1;
    }
  }

  getEntityVec(name) {
    const idx = this.entityIdx.get(name);
    if (idx === undefined) throw new Error(`Unknown entity: ${name}`);
    return this.E.subarray(idx * this.dim, (idx + 1) * this.dim);
  }

  getRelationVec(name) {
    const idx = this.relationIdx.get(name);
    if (idx === undefined) throw new Error(`Unknown relation: ${name}`);
    return this.R.subarray(idx * this.dim, (idx + 1) * this.dim);
  }

  score(h, r, t) {
    const he = this.getEntityVec(h);
    const re = this.getRelationVec(r);
    const te = this.getEntityVec(t);
    let s = 0;
    for (let i = 0; i < this.dim; i++) {
      const d = he[i] + re[i] - te[i];
      s += d * d;
    }
    return Math.sqrt(s);
  }

  /** One-step gradient update with a single (positive, negative) triple. */
  trainStep(posH, posR, posT, negH, negT, lr = 0.01) {
    const posScore = this.score(posH, posR, posT);
    const negScore = this.score(negH, posR, negT);
    const margin = this.margin + negScore - posScore;
    if (margin <= 0) return 0; // no update needed
    // Update entity/relation embeddings along the gradient direction
    const posE = this.getEntityVec(posH);
    const negE = this.getEntityVec(negH);
    const posTE = this.getEntityVec(posT);
    const rE = this.getRelationVec(posR);
    const update = (a, b, sign) => {
      const d = a + b;
      const norm = Math.max(Math.sqrt(d.reduce((s, x, i) => s + x * x, 0)), 1e-8);
      for (let i = 0; i < this.dim; i++) {
        const grad = (2 * (a[i] + rE[i] - posTE[i])) / norm;
        posE[i] -= lr * sign * grad;
      }
    };
    for (let i = 0; i < this.dim; i++) {
      const d_pos = posE[i] + rE[i] - posTE[i];
      const d_neg = negE[i] + rE[i] - posTE[i];
      posE[i] -= lr * 2 * d_pos;
      posTE[i] += lr * 2 * d_pos;
      negE[i] += lr * 2 * d_neg;
      rE[i] -= lr * 2 * (d_pos - d_neg);
    }
    return margin;
  }
}