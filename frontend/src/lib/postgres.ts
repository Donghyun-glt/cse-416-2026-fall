import { Pool, type PoolClient, type QueryResultRow } from "pg";

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
  postgresState.pool = new Pool({
    connectionString,
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  return postgresState.pool;
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
