/* eslint-disable @typescript-eslint/no-require-imports -- Node's CommonJS test harness loads transpiled route modules. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const { NextRequest } = require("next/server");

// Run the real route handlers with a fake Google service. No credentials or
// network calls are needed, and tokens never leave the test process.
function handler(route, configured = true) {
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
    exports, URL, console,
    process: { env: configured ? {
      NODE_ENV: "production", GOOGLE_CLIENT_ID: "app-client",
      GOOGLE_CLIENT_SECRET: "app-secret", GOOGLE_REDIRECT_URI: "https://mailflow.test/api/google/callback",
    } : {} },
    require(name) {
      if (name === "@/lib/google") return {
        createGoogleOAuthClient: () => client,
        GMAIL_MODIFY_SCOPE: "https://www.googleapis.com/auth/gmail.modify",
        GOOGLE_PROFILE_SCOPES: ["openid", "email", "profile"],
      };
      if (name === "@/lib/gmail-session") return {
        saveGmailSession: (id, tokens) => sessions.set(id, tokens),
      };
      return require(name);
    },
  });
  return { GET: exports.GET, sessions, authorization: () => authorization };
}

function request(path, cookie = "") {
  return new NextRequest(`https://mailflow.test${path}`, { headers: { cookie } });
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
