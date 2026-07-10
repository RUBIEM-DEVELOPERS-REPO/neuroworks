// Optional engine drivers are dynamic-imported in data-sources.ts so the
// server boots without them installed. Declare them as any here so the
// TypeScript checker treats the imports as opaque modules — the runtime
// fallback handles the missing-package case with a clear error message.
declare module "pg";
declare module "mysql2/promise";
declare module "better-sqlite3";
declare module "mssql";
declare module "mongodb";
