import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { withVerifiedSsl } from "./database-url.mjs";

type PostgresState = { pool?: Pool };

const globalWithPostgres = globalThis as typeof globalThis & {
  mailflowPostgresState?: PostgresState;
};

const postgresState = globalWithPostgres.mailflowPostgresState
  ?? (globalWithPostgres.mailflowPostgresState = {});

function getPool() {
  if (postgresState.pool) return postgresState.pool;
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error("DATABASE_URL must be configured for MailFlow PostgreSQL storage.");
  }
  const pool = new Pool({
    connectionString: withVerifiedSsl(connectionString),
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    // Opening a connection to the database (TLS and sign-in) takes far longer than a query
    // (measured 1.4 s against 0.19 s from a distant region), so idle connections are kept
    // for 5 minutes instead of 30 s: a pause in use no longer makes the next request reconnect.
    // 5 minutes matches Neon's default auto-suspend, after which the server ends them anyway.
    idleTimeoutMillis: 5 * 60_000,
    connectionTimeoutMillis: 10_000,
    keepAlive: true,
  });
  // A kept connection can be closed by the database (suspend, restart, network). pg then
  // emits "error" on the pool, which would crash the server without a listener; the pool
  // has already dropped that connection and opens a new one for the next query.
  pool.on("error", (error) => console.error("Idle PostgreSQL connection closed", error.message));
  postgresState.pool = pool;
  return pool;
}

export function query<Row extends QueryResultRow = QueryResultRow>(
  text: string,
  values: readonly unknown[] = [],
) {
  return getPool().query<Row>(text, [...values]);
}

export async function withTransaction<T>(work: (client: PoolClient) => Promise<T>) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
