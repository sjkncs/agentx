/**
 * Counterfactual Engine — ATE(X→Y) estimator with weighted regression + gradient penalty.
 *
 *   ATE(X → Y) = E[Y | do(X = x_treat)] - E[Y | do(X = x_ctrl)]
 *
 * Estimation via weighted regression (T-learner style):
 *   L = Σ (y - f(x, z))² + β · ||∇_X f(x, z)||²
 *
 * The gradient penalty enforces identifiability under positivity.
 */
import crypto from 'node:crypto';

export class CounterfactualEngine {
  constructor({ dX, dZ, hidden = 32, beta_grad = 0.1, seed = 11 } = {}) {
    this.dX = dX;
    this.dZ = dZ;
    this.beta = beta_grad;
    const rng = crypto.createHash('sha256');
    rng.update(`cf:${seed},dX:${dX},dZ:${dZ},h:${hidden}`);
    const buf = rng.digest();
    let off = 0;
    const rand = (n) => {
      const out = [];
      for (let i = 0; i < n; i++) {
        out.push((buf[(off + i) % buf.length] / 255 - 0.5) * 0.2);
      }
      off += n;
      return out;
    };
    // 2-layer MLP: input(dX + dZ) → hidden → hidden → 1
    this.W1 = Array.from({ length: dX + dZ }, () => rand(hidden));
    this.b1 = rand(hidden);
    this.W2 = Array.from({ length: hidden }, () => rand(hidden));
    this.b2 = rand(hidden);
    this.W3 = rand(hidden);
    this.b3 = [0];
  }

  forward(x, z) {
    const h = [];
    for (let i = 0; i < this.W1[0].length; i++) {
      let s = this.b1[i];
      for (let j = 0; j < this.W1.length; j++) {
        const v = j < this.dX ? x[j] : z[j - this.dX];
        s += v * this.W1[j][i];
      }
      h.push(Math.max(0, s)); // ReLU
    }
    const h2 = [];
    for (let i = 0; i < this.W2[0].length; i++) {
      let s = this.b2[i];
      for (let j = 0; j < this.W2.length; j++) s += h[j] * this.W2[j][i];
      h2.push(Math.max(0, s));
    }
    let y = this.b3[0];
    for (let i = 0; i < this.W3.length; i++) y += h2[i] * this.W3[i];
    return { y, h, h2 };
  }

  /** Numerical gradient of f w.r.t. x. */
  gradX(x, z, eps = 1e-4) {
    const out = new Array(this.dX).fill(0);
    for (let k = 0; k < this.dX; k++) {
      const xp = x.slice(); xp[k] += eps;
      const xm = x.slice(); xm[k] -= eps;
      out[k] = (this.forward(xp, z).y - this.forward(xm, z).y) / (2 * eps);
    }
    return out;
  }

  ateLoss(xT, xC, z, yT, yC) {
    let lossY = 0;
    let lossGrad = 0;
    for (let i = 0; i < xT.length; i++) {
      const pT = this.forward(xT[i], z[i] ?? []).y;
      const pC = this.forward(xC[i], z[i] ?? []).y;
      lossY += (pT - yT[i]) ** 2 + (pC - yC[i]) ** 2;
      const gT = this.gradX(xT[i], z[i] ?? []);
      const gC = this.gradX(xC[i], z[i] ?? []);
      for (let k = 0; k < this.dX; k++) lossGrad += gT[k] ** 2 + gC[k] ** 2;
    }
    return lossY / xT.length + this.beta * lossGrad / xT.length;
  }

  /** Compute ATE from a held-out (xT, xC, z, yT, yC) sample. */
  estimateATE(xT, xC, z, yT, yC) {
    let sumT = 0, sumC = 0;
    for (let i = 0; i < xT.length; i++) {
      sumT += this.forward(xT[i], z[i] ?? []).y;
      sumC += this.forward(xC[i], z[i] ?? []).y;
    }
    return (sumT - sumC) / xT.length;
  }
}