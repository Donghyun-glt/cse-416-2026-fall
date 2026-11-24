/* eslint-disable @typescript-eslint/no-require-imports -- Node's CommonJS test harness loads transpiled route modules. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { createHash } = require("node:crypto");
const vm = require("node:vm");
const ts = require("typescript");
const { NextRequest } = require("next/server");

// Run the real route handlers with a fake Google service. No credentials or
// network calls are needed, and tokens never leave the test process.
function handler(route, configured = true, options = {}) {
  const sessions = new Map();
  let authorization;
  const client = {
    generateAuthUrl(options) {
      authorization = options;
      return "https://accounts.google.com/o/oauth2/v2/auth";
    },
    async getToken(code) {
      assert.equal(code, "valid-code");
      return { tokens: { access_token: "fake-access", refresh_token: "fake-refresh" } };
    },
  };
  const source = readFileSync(resolve(__dirname, `../src/app/api/google/${route}/route.ts`), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, URL, console: options.console ?? console,
    process: { env: configured ? {
      NODE_ENV: "production", GOOGLE_CLIENT_ID: "app-client",
      GOOGLE_CLIENT_SECRET: "app-secret", GOOGLE_REDIRECT_URI: "https://mailflow.test/api/google/callback",
      DATABASE_URL: "postgresql://example.test/db", SESSION_SECRET: "test-secret",
    } : {} },
    require(name) {
      if (name === "@/lib/google") return {
        createGoogleOAuthClient: () => client,
        GMAIL_MODIFY_SCOPE: "https://www.googleapis.com/auth/gmail.modify",
        CALENDAR_EVENTS_SCOPE: "https://www.googleapis.com/auth/calendar.events",
        GOOGLE_PROFILE_SCOPES: ["openid", "email", "profile"],
      };
      if (name === "@/lib/gmail-session") return {
        createGmailSession: async (tokens) => {
          const sealed = `sealed-${sessions.size}`;
          sessions.set(sealed, tokens);
          return sealed;
        },
        deleteGmailSession: async (sessionId) => {
          if (options.failDelete) throw new Error("Database unavailable");
          sessions.delete(sessionId);
        },
      };
      return require(name);
    },
  });
  return { GET: exports.GET, POST: exports.POST, sessions, authorization: () => authorization };
}

function request(path, cookie = "", init = {}) {
  return new NextRequest(`https://mailflow.test${path}`, { ...init, headers: { cookie, ...init.headers } });
}

test("login requests account selection, Gmail consent, and offline access", async () => {
  const route = handler("connect");
  const response = await route.GET(request("/api/google/connect?popup=1"));
  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location"), "https://accounts.google.com/o/oauth2/v2/auth");
  const options = route.authorization();
  assert.equal(options.prompt, "select_account consent");
  assert.equal(options.access_type, "offline");
  assert.ok(options.scope.includes("https://www.googleapis.com/auth/gmail.modify"));
  assert.ok(options.scope.includes("https://www.googleapis.com/auth/calendar.events"));
  assert.equal(response.cookies.get("gmail_oauth_state").value, options.state);
  assert.equal(response.cookies.get("gmail_oauth_popup").value, "1");
  assert.match(response.headers.get("set-cookie"), /HttpOnly/);
  assert.match(response.headers.get("set-cookie"), /Secure/);
});

test("unconfigured server returns a recoverable login error", async () => {
  const route = handler("connect", false);
  const response = await route.GET(request("/api/google/connect?popup=1"));
  assert.equal(response.headers.get("location"), "https://mailflow.test/auth/google/complete?error=oauth_not_configured");
});

test("successful popup login creates an individual server session", async () => {
  const route = handler("callback");
  const response = await route.GET(request("/api/google/callback?state=expected&code=valid-code", "gmail_oauth_state=expected; gmail_oauth_popup=1"));
  assert.equal(response.headers.get("location"), "https://mailflow.test/auth/google/complete");
  const session = response.cookies.get("gmail_session").value;
  assert.equal(route.sessions.get(session).refresh_token, "fake-refresh");
  assert.equal(response.cookies.get("gmail_oauth_state").value, "");
  assert.equal(response.cookies.get("gmail_oauth_popup").value, "");
  assert.ok(!response.headers.get("location").includes("fake-access"));
});

test("blocked-popup redirect flow still returns to the app", async () => {
  const route = handler("callback");
  const response = await route.GET(request("/api/google/callback?state=expected&code=valid-code", "gmail_oauth_state=expected; gmail_oauth_popup=0"));
  assert.equal(response.headers.get("location"), "https://mailflow.test/");
  assert.equal(route.sessions.size, 1);
});

test("mismatched state cannot create a session", async () => {
  const route = handler("callback");
  const response = await route.GET(request("/api/google/callback?state=wrong&code=valid-code", "gmail_oauth_state=expected; gmail_oauth_popup=1"));
  assert.equal(response.headers.get("location"), "https://mailflow.test/auth/google/complete?error=invalid_oauth_state");
  assert.equal(route.sessions.size, 0);
});

test("denied consent returns an error and clears the OAuth attempt", async () => {
  const route = handler("callback");
  const response = await route.GET(request("/api/google/callback?state=expected&error=access_denied", "gmail_oauth_state=expected; gmail_oauth_popup=1"));
  assert.equal(response.headers.get("location"), "https://mailflow.test/auth/google/complete?error=access_denied");
  assert.equal(response.cookies.get("gmail_oauth_state").value, "");
  assert.equal(route.sessions.size, 0);
});

function sessionModule(secret, query = async () => ({ rows: [] })) {
  const source = readFileSync(resolve(__dirname, "../src/lib/gmail-session.ts"), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, Buffer, JSON, process: { env: { SESSION_SECRET: secret } },
    require(name) {
      if (name === "./postgres") return { query };
      if (name === "./google") return { createGoogleOAuthClient: () => { throw new Error("no Google calls in these tests"); } };
      return require(name);
    },
  });
  return exports;
}

test("OAuth token encryption round-trips without exposing plaintext", () => {
  const { sealGmailTokens, openGmailTokens } = sessionModule("test-secret");
  const sealed = sealGmailTokens({ access_token: "fake-access", refresh_token: "fake-refresh", id_token: "large" });
  assert.ok(!sealed.includes("fake"));
  const tokens = openGmailTokens(sealed);
  assert.equal(tokens.refresh_token, "fake-refresh");
  assert.equal(tokens.id_token, undefined);
});

test("tampered or foreign session cookies are rejected", () => {
  const { sealGmailTokens, openGmailTokens } = sessionModule("test-secret");
  const sealed = sealGmailTokens({ refresh_token: "fake-refresh" });
  const tampered = `${sealed.slice(0, -2)}${sealed.endsWith("A") ? "B" : "A"}A`;
  assert.equal(openGmailTokens(tampered), undefined);
  assert.equal(openGmailTokens("not-a-session"), undefined);
  assert.equal(sessionModule("other-secret").openGmailTokens(sealed), undefined);
});

test("logout ends only the current session and expires its cookies on every retry", async () => {
  const route = handler("logout");
  route.sessions.set("current", {});
  route.sessions.set("another-device", {});
  const post = () => route.POST(request("/api/google/logout", "gmail_session=current; mailflow_theme=dark", {
    method: "POST", headers: { "sec-fetch-site": "same-origin" },
  }));

  for (const response of [await post(), await post()]) {
    assert.equal(response.status, 204);
    for (const name of ["gmail_session", "gmail_oauth_state", "gmail_oauth_popup"]) {
      assert.equal(response.cookies.get(name).maxAge, 0);
      assert.equal(response.cookies.get(name).path, "/");
    }
    assert.equal(response.cookies.get("mailflow_theme"), undefined);
  }
  assert.deepEqual([...route.sessions.keys()], ["another-device"]);
});

test("logout preserves the session on cross-origin requests and database failures", async () => {
  const route = handler("logout", true, { failDelete: true, console: { error() {} } });
  route.sessions.set("current", {});
  for (const [fetchSite, status] of [["same-site", 403], ["same-origin", 503]]) {
    const response = await route.POST(request("/api/google/logout", "gmail_session=current", {
      method: "POST", headers: { "sec-fetch-site": fetchSite },
    }));
    assert.equal(response.status, status);
    assert.equal(response.headers.get("set-cookie"), null);
    assert.ok(route.sessions.has("current"));
  }
});

test("session deletion targets the stored hash of the opaque session ID", async () => {
  let queryCalls = 0;
  const { deleteGmailSession } = sessionModule("test-secret", async (sql, params) => {
    queryCalls += 1;
    assert.equal(sql, "DELETE FROM oauth_sessions WHERE session_hash = $1");
    assert.equal(params.length, 1);
    assert.equal(params[0], createHash("sha256").update("opaque-session").digest("hex"));
  });
  await deleteGmailSession("opaque-session");
  assert.equal(queryCalls, 1);
});

test("stored tokens are bound to the session cookie, not only to the server secret", () => {
  const { sealGmailTokens, openGmailTokens } = sessionModule("test-secret");
  const sealed = sealGmailTokens({ refresh_token: "fake-refresh" }, "cookie-a");
  assert.equal(openGmailTokens(sealed, "cookie-a").refresh_token, "fake-refresh");
  assert.equal(openGmailTokens(sealed, "cookie-b"), undefined);
  assert.equal(openGmailTokens(sealed), undefined); // The server secret alone is not enough.
  // Sessions created before this change still open until they expire.
  assert.equal(openGmailTokens(sealGmailTokens({ refresh_token: "old" }), "cookie-a").refresh_token, "old");
});
