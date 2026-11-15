"use client";

import { useState } from "react";

type Result = { region?: string; connected?: boolean; greeting?: string; login?: string; detail?: string; ms?: number; error?: string };
const targets = [["Default region", "/api/naver/imap-test"], ["Seoul (icn1)", "/api/naver/imap-test/seoul"]] as const;

// Developer page: checks whether this deployment can reach Naver Mail over IMAP.
export default function NaverTestPage() {
  const [address, setAddress] = useState("");
  const [appPassword, setAppPassword] = useState("");
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<Record<string, Result>>({});
  async function run(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setRunning(true); setResults({});
    for (const [label, url] of targets) {
      let result: Result;
      try {
        const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address, appPassword }) });
        result = await response.json() as Result;
      } catch (cause) { result = { error: cause instanceof Error ? cause.message : "request_failed" }; }
      setResults((current) => ({ ...current, [label]: result }));
    }
    setRunning(false);
  }
  const field = "mt-1 w-full rounded-lg border border-[#d8d5df] p-2 text-sm";
  return <main className="mx-auto max-w-xl space-y-5 p-8 text-sm text-[#1f1f1f]">
    <h1 className="text-xl font-extrabold">Naver Mail connection test</h1>
    <p className="text-[#666]">Developer test for MailFlow. It opens one IMAP connection to imap.naver.com from this server and logs out. Nothing is stored. Sign in to MailFlow first.</p>
    <form onSubmit={run} className="space-y-3">
      <label className="block">Naver address<input required type="email" placeholder="name@naver.com" value={address} onChange={(e) => setAddress(e.target.value)} className={field} /></label>
      <label className="block">Application password (optional)<input type="password" autoComplete="off" value={appPassword} onChange={(e) => setAppPassword(e.target.value)} className={field} /></label>
      <p className="text-xs text-[#666]">Use a Naver application password, never your Naver login password. Leave it empty to test reachability only.</p>
      <button disabled={running} className="rounded-lg bg-[#5944d8] px-4 py-2 font-semibold text-white disabled:opacity-50">{running ? "Testing…" : "Run test"}</button>
    </form>
    {targets.map(([label]) => results[label] && <section key={label} className="rounded-xl border border-[#e3e3e3] p-4">
      <h2 className="font-bold">{label}{results[label].region ? ` · ran in ${results[label].region}` : ""}</h2>
      {results[label].error ? <p className="mt-1 text-red-700">Request failed: {results[label].error}</p> : <ul className="mt-2 space-y-1">
        <li>Reached Naver: <strong>{results[label].connected ? "yes" : "no"}</strong>{results[label].ms !== undefined ? ` (${results[label].ms} ms)` : ""}</li>
        <li>Login: <strong>{results[label].login}</strong></li>
        {results[label].greeting && <li className="break-words text-xs text-[#666]">Greeting: {results[label].greeting}</li>}
        {results[label].detail && <li className="break-words text-xs text-[#666]">Server said: {results[label].detail}</li>}
      </ul>}
    </section>)}
  </main>;
}
