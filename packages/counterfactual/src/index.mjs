/**
 * @datafoundry/counterfactual — public API
 *
 * CDL = UnifiedSemanticLayer + CausalDAG + CounterfactualEngine + RegimeJoint
 */
export { UnifiedSemanticLayer, DEFAULT_ENTITIES, DEFAULT_RELATIONS } from './semantic-layer.mjs';
export { CausalDAG } from './causal-dag.mjs';
export { CounterfactualEngine } from './counterfactual-engine.mjs';
export { jointDecision, regimeConditionalDecision, theorem3Gap, alphaOf, ALPHA_BY_REGIME } from './regime-joint.mjs';