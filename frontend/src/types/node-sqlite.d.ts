declare module "node:sqlite" {
  type SQLInputValue = null | number | bigint | string | Uint8Array;

  type RunResult = {
    lastInsertRowid: number | bigint;
    changes: number;
  };

  class StatementSync {
    run(...anonymousParameters: SQLInputValue[]): RunResult;
    get(...anonymousParameters: SQLInputValue[]): unknown;
    all(...anonymousParameters: SQLInputValue[]): unknown[];
  }

  export class DatabaseSync {
    constructor(location: string);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}
