import pg from "pg";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be configured before applying the Google auth schema.");
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const statements = [
  `CREATE TABLE IF NOT EXISTS era_auth_accounts (
    id text PRIMARY KEY,
    user_id text NOT NULL REFERENCES era_users(id) ON DELETE CASCADE,
    provider text NOT NULL DEFAULT 'google',
    provider_user_id text NOT NULL,
    email text NOT NULL,
    name text NOT NULL,
    avatar_url text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS era_auth_accounts_provider_user_uq
    ON era_auth_accounts(provider, provider_user_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS era_auth_accounts_user_provider_uq
    ON era_auth_accounts(user_id, provider)`,
  `CREATE TABLE IF NOT EXISTS era_auth_sessions (
    token_hash text PRIMARY KEY,
    user_id text NOT NULL REFERENCES era_users(id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS era_auth_sessions_user_id_idx
    ON era_auth_sessions(user_id)`,
  `CREATE INDEX IF NOT EXISTS era_auth_sessions_expires_at_idx
    ON era_auth_sessions(expires_at)`,
  `CREATE TABLE IF NOT EXISTS era_google_oauth_states (
    state_hash text PRIMARY KEY,
    nonce text NOT NULL,
    code_verifier text NOT NULL,
    redirect_uri text NOT NULL,
    return_to text NOT NULL,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
];

const client = await pool.connect();
try {
  await client.query("BEGIN");
  for (const statement of statements) await client.query(statement);
  await client.query("COMMIT");
  process.stdout.write("Google auth tables and indexes are ready.\n");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
