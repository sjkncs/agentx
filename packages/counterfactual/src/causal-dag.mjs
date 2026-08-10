/**
 * Causal DAG — NOTEARS-style acyclicity-constrained learner over the semantic layer.
 *
 * Loss: L(W) = ||X - XW||² + λ · h(W),  h(W) = tr(e^{W∘W}) - d
 *
 * Simplified: operates on activations over the entity embedding space; produces
 * a W matrix of shape (n, n) where W[i,j] indicates causal strength from j → i.
 */
import crypto from 'node:crypto';

export class CausalDAG {
  constructor({ n, lambda_acyclic = 0.1, seed = 7 } = {}) {
    this.n = n;
    this.lambda = lambda_acyclic;
    const rng = crypto.createHash('sha256');
    rng.update(`notears:${seed},n:${n}`);
    const buf = rng.digest();
    this.W = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => {
        if (i === j) return 0;
        const idx = (i * n + j) % buf.length;
        return ((buf[idx] / 255) - 0.5) * 0.1;
      }),
    );
  }

  /** Reconstruction loss ||X - XW||² (assuming X is n × T). */
  reconLoss(X) {
    const n = this.n;
    const T = X[0].length;
    let loss = 0;
    for (let i = 0; i < n; i++) {
      for (let t = 0; t < T; t++) {
        let pred = 0;
        for (let j = 0; j < n; j++) pred += X[j][t] * this.W[i][j];
        const r = X[i][t] - pred;
        loss += r * r;
      }
    }
    return loss / T;
  }

  /** Acyclicity h(W) = tr(e^{W∘W}) - d. */
  acyclicity() {
    const n = this.n;
    const W2 = this.W.map((row, i) => row.map((w, j) => w * w));
    // Matrix exponential via power-series with truncation (k up to n-1)
    let M = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
    let trace = 0;
    let kFactorial = 1;
    for (let k = 1; k <= n; k++) {
      kFactorial *= k;
      const Mnext = Array.from({ length: n }, () => Array(n).fill(0));
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          let s = 0;
          for (let m = 0; m < n; m++) s += M[i][m] * W2[m][j];
          Mnext[i][j] = s;
        }
      }
      M = Mnext;
      if (k === n) {
        for (let i = 0; i < n; i++) trace += M[i][i];
      }
    }
    return trace - n;
  }

  totalLoss(X) {
    return this.reconLoss(X) + this.lambda * this.acyclicity();
  }

  /** Single gradient step (numerical gradient, robust to small n). */
  step(X, lr = 0.01, eps = 1e-4) {
    const base = this.totalLoss(X);
    const grads = Array.from({ length: this.n }, () => Array(this.n).fill(0));
    for (let i = 0; i < this.n; i++) {
      for (let j = 0; j < this.n; j++) {
        if (i === j) continue;
        this.W[i][j] += eps;
        const up = this.totalLoss(X);
        this.W[i][j] -= 2 * eps;
        const down = this.totalLoss(X);
        this.W[i][j] += eps;
        grads[i][j] = (up - down) / (2 * eps);
      }
    }
    for (let i = 0; i < this.n; i++) {
      for (let j = 0; j < this.n; j++) {
        if (i === j) continue;
        this.W[i][j] -= lr * grads[i][j];
        // Threshold small weights to zero
        if (Math.abs(this.W[i][j]) < 1e-3) this.W[i][j] = 0;
      }
    }
    return base;
  }

  /** Get the parent set of node i (indices of nodes with non-zero W[i][j]). */
  parents(i) {
    const out = [];
    for (let j = 0; j < this.n; j++) {
      if (j !== i && Math.abs(this.W[i][j]) > 1e-3) out.push(j);
    }
    return out;
  }
}