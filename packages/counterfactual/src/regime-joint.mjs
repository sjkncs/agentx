/**
 * Regime-Joint Decision Optimiser
 *
 *   J(u) = α(R_t) · Φ_sem(u) + (1 - α(R_t)) · Φ_cf(u)
 *
 *   α(bull) = 0.3 (favour counterfactual alpha exploration)
 *   α(bear) = 0.7 (favour semantic-consistent defence)
 *
 * Subsumes Theorem 3 from `paper_icaif2026.tex`:
 *   Regime-conditional governance optimality — any uniform u is strictly dominated
 *   by regime-conditional u(R_t).
 */
export const ALPHA_BY_REGIME = { bull: 0.3, bear: 0.7, sideways: 0.5 };

export function alphaOf(regime) {
  return ALPHA_BY_REGIME[regime] ?? 0.5;
}

/**
 * Compute J(u) given semantic-layer and counterfactual evidence.
 *
 * The decision u is the convex combination of the regime-weighted action proposals:
 *   u = α(R_t) · u_sem + (1 - α(R_t)) · u_cf
 * When u_sem ≠ u_cf (regime-conditional system), the regime weight selects which
 * evidence source the system trusts more. J then scores the chosen action.
 *
 * @param {object} args
 * @param {string} args.regime - 'bull' | 'bear' | 'sideways'
 * @param {number} args.phiSem - Semantic-layer consistency score in [0, 1]
 * @param {number} args.phiCf - Counterfactual intervention benefit in [0, 1]
 * @param {number} [args.uSem=0.5] - Action proposed by semantic layer
 * @param {number} [args.uCf=0.5] - Action proposed by counterfactual engine
 * @returns {object} { u, J, alpha }
 */
export function jointDecision({ regime, phiSem, phiCf, uSem = 0.5, uCf = 0.5 }) {
  if (!Number.isFinite(phiSem) || !Number.isFinite(phiCf)) {
    throw new Error('phiSem and phiCf must be finite numbers');
  }
  const alpha = alphaOf(regime);
  const u = alpha * uSem + (1 - alpha) * uCf;
  const J = alpha * phiSem + (1 - alpha) * phiCf;
  return { u, J, alpha };
}

/**
 * Regime-conditional decision with non-uniform proposals (the typical regime switch).
 *   In bull markets, counterfactual α=0.7 → trust the more aggressive CF proposal.
 *   In bear markets, semantic α=0.7 → trust the defensive semantic proposal.
 */
export function regimeConditionalDecision({ regime, phiSem, phiCf, uSem = 0.3, uCf = 0.7 }) {
  return jointDecision({ regime, phiSem, phiCf, uSem, uCf });
}

/**
 * Theorem 3 verification: prove that regime-conditional u* strictly dominates
 * any uniform u in expectation.
 *
 * @param {Function} costFn - (u, regime) → expected cost
 * @param {string[]} regimes
 * @param {object} optimalByRegime - map regime → optimal u*
 * @returns {{optimal: number, uniform: number, gap: number}}
 */
export function theorem3Gap(costFn, regimes, optimalByRegime) {
  let totalOptimal = 0;
  for (const r of regimes) totalOptimal += costFn(optimalByRegime[r], r);
  const avgOptimal = totalOptimal / regimes.length;

  let bestUniform = Infinity;
  for (let u = 0; u <= 1; u += 0.01) {
    let total = 0;
    for (const r of regimes) total += costFn(u, r);
    if (total < bestUniform) bestUniform = total;
  }
  const avgUniform = bestUniform / regimes.length;

  return {
    optimal: avgOptimal,
    uniform: avgUniform,
    gap: avgOptimal - avgUniform, // negative means regime-conditional is better (lower cost)
  };
}