// Configure React 19's `act` to recognize this test environment.
// Without this flag, React emits "The current testing environment is not
// configured to support act(...)" whenever a test calls `act` (e.g. when
// wrapping `createRoot(...).render(...)` for component testing).
export {};

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
