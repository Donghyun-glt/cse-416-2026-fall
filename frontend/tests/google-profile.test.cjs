/* eslint-disable @typescript-eslint/no-require-imports -- The CommonJS test harness runs the transpiled route with a fake Google API. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const nextServer = require("next/server");

// userinfo: what Google's userinfo endpoint answers, or an Error with a status to throw.
function loadRoute(userinfo) {
  const route = {};
  const source = readFileSync(resolve(__dirname, "../src/app/api/google/profile/route.ts"), "utf8");
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, {
    exports: route, console,
    require(name) {
      if (name === "next/server") return { NextResponse: nextServer.NextResponse };
      if (name === "googleapis") return { google: {
        gmail: () => ({ users: { getProfile: async () => ({ data: { emailAddress: "alex@example.com" } }) } }),
        oauth2: () => ({ userinfo: { get: async () => { if (userinfo instanceof Error) throw userinfo; return { data: userinfo }; } } }),
      } };
      if (name === "@/lib/google") return { createGoogleOAuthClient: () => ({ setCredentials() {} }), GMAIL_MODIFY_SCOPE: "gmail.modify" };
      if (name === "@/lib/gmail-session") return { getGmailSession: async () => ({ access_token: "t", scope: "gmail.modify openid email profile" }), attachGmailSessionToUser: async () => {} };
      if (name === "@/lib/mailflow-db") return { upsertUser: async () => 1 };
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  return async () => (await route.GET(new nextServer.NextRequest("https://mailflow.test/api/google/profile", { headers: { cookie: "gmail_session=s" } }))).json();
}

test("the Google profile photo comes back with the name, sized for sharp avatars", async () => {
  const profile = await loadRoute({ name: "Alex Kim", picture: "https://lh3.googleusercontent.com/a/ACg8ocK123=s96-c" })();
  assert.equal(profile.name, "Alex Kim");
  assert.equal(profile.picture, "https://lh3.googleusercontent.com/a/ACg8ocK123=s192-c");
});

test("only Google's image host is accepted, and no photo is fine", async () => {
  assert.equal((await loadRoute({ name: "Alex", picture: "https://evil.example.com/a.png" })()).picture, "");
  assert.equal((await loadRoute({ name: "Alex", picture: "http://lh3.googleusercontent.com/a/x=s96-c" })()).picture, "");
  assert.equal((await loadRoute({ name: "Alex" })()).picture, "");
});

test("a session without the profile permission still works, with no photo", async () => {
  const denied = Object.assign(new Error("forbidden"), { code: 403 });
  const profile = await loadRoute(denied)();
  assert.equal(profile.name, "alex");
  assert.equal(profile.picture, "");
  assert.equal(profile.requiresProfileAuthorization, true);
});
