// Plain JavaScript so both the Next.js server and the node scripts in
// scripts/ can import it without a TypeScript loader.

/**
 * pg currently treats sslmode=prefer, require and verify-ca as verify-full
 * (and warns about it on every start). pg v9 will switch them to the weaker
 * libpq meaning, where `require` no longer checks the server certificate.
 * Pin verify-full so today's behaviour is kept and the warning goes away,
 * whatever the connection string copied from Neon says.
 *
 * @param {string} connectionString
 * @returns {string}
 */
export function withVerifiedSsl(connectionString) {
  if (/[?&]uselibpqcompat=true(?:&|$)/.test(connectionString)) return connectionString;
  return connectionString.replace(/([?&]sslmode=)(?:prefer|require|verify-ca)(?=&|#|$)/, "$1verify-full");
}
