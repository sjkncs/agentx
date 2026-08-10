// Type shim document: re-enable row-shaped defaults for better-sqlite3 so
// data-gateway keeps compiling without per-callback annotations.
import 'better-sqlite3';

declare module 'better-sqlite3' {
  namespace Database {
    type Statement<BindParameters extends unknown[] | {} = unknown[], Result = Record<string, any>> =
      BindParameters extends unknown[]
        ? BetterSqlite3.Statement<BindParameters, Result>
        : BetterSqlite3.Statement<[BindParameters], Result>;
  }
}
