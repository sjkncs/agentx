// Make better-sqlite3's default row shape behave like node:sqlite's
// `Record<string, SQLOutputValue>` so legacy metadata/data-gateway code
// (which used `DatabaseSync` and got back Record-shaped rows) keeps type
// checking without per-callback annotations.
//
// Re-declare the constructor class at the top level so that callers can
// `import Database from "better-sqlite3"` and use `Database` as both a value
// (constructor) and a type (instance) without namespace-vs-value conflicts.
import 'better-sqlite3';

declare module 'better-sqlite3' {
  namespace BetterSqlite3 {
    interface Statement<BindParameters extends unknown[], Result = Record<string, any>> {
      run(...params: BindParameters): unknown;
      get(...params: BindParameters): Record<string, any> | undefined;
      all(...params: BindParameters): Record<string, any>[];
      iterate(...params: BindParameters): IterableIterator<Record<string, any>>;
      bind(...params: BindParameters): this;
      reset(): this;
      pluck(toggle?: boolean): this;
      expand(toggle?: boolean): this;
      raw(toggle?: boolean): this;
      columns(): { column: string; type: string; name: string; cct: string }[];
    }
  }

  // Default Result in Statement<BindParameters> defaults to Record<string, any>
  // so the no-args prepare() path also returns a row-shaped Statement.
  namespace Database {
    type Statement<BindParameters extends unknown[] | {} = unknown[], Result = Record<string, any>> =
      BindParameters extends unknown[]
        ? BetterSqlite3.Statement<BindParameters, Result>
        : BetterSqlite3.Statement<[BindParameters], Result>;
  }
}
