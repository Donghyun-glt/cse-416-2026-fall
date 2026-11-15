// Connectivity probe for Naver Mail over IMAP: can this server reach imap.naver.com,
// and does a Naver address + application password log in? It opens one TLS connection,
// reads the greeting, optionally sends LOGIN, then logs out. No mailbox is opened and
// nothing is stored. Uses node:tls directly so the probe needs no extra dependency.
import { connect as tlsConnect } from "node:tls";

export type ImapCheck = {
  /** TLS connection made and the server greeted us. */
  connected: boolean;
  greeting?: string;
  /** skipped = no password given, so only reachability was tested. */
  login: "ok" | "rejected" | "skipped" | "not_reached";
  /** The server's own reply text, or the network error. Never contains the password. */
  detail?: string;
  ms: number;
};

type Socket = {
  on(event: "data", listener: (chunk: Buffer | string) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  on(event: "close", listener: () => void): unknown;
  write(data: string): unknown;
  destroy(): unknown;
};
type Connect = (options: { host: string; port: number; servername: string }) => Socket;

const quoted = (value: string) => `"${value.replace(/[\\"]/g, "\\$&")}"`;

export function checkImapLogin(input: { user: string; password?: string; host?: string; port?: number; timeoutMs?: number; connect?: Connect }): Promise<ImapCheck> {
  const host = input.host ?? "imap.naver.com";
  const started = Date.now();
  // A line break inside a credential would let it smuggle a second IMAP command.
  if (/[\r\n]/.test(input.user) || /[\r\n]/.test(input.password ?? "")) {
    return Promise.resolve({ connected: false, login: "not_reached", detail: "Invalid characters in the credentials.", ms: 0 });
  }
  return new Promise((resolve) => {
    let settled = false, buffer = "", greeting: string | undefined, stage: "greeting" | "login" = "greeting";
    const socket = (input.connect ?? (tlsConnect as unknown as Connect))({ host, port: input.port ?? 993, servername: host });
    const finish = (result: Omit<ImapCheck, "ms" | "greeting">) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      try { if (result.connected) socket.write("z9 LOGOUT\r\n"); } catch { /* Already closed. */ }
      socket.destroy();
      resolve({ ...result, greeting, ms: Date.now() - started });
    };
    const timer = setTimeout(() => finish({ connected: Boolean(greeting), login: "not_reached", detail: `No response from ${host} within ${(input.timeoutMs ?? 10000) / 1000}s.` }), input.timeoutMs ?? 10000);
    socket.on("error", (error) => finish({ connected: Boolean(greeting), login: "not_reached", detail: error.message }));
    socket.on("close", () => finish({ connected: Boolean(greeting), login: "not_reached", detail: "The server closed the connection." }));
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      let end: number;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end).replace(/\r$/, ""); buffer = buffer.slice(end + 1);
        if (stage === "greeting") {
          if (!/^\* (OK|PREAUTH)/i.test(line)) { finish({ connected: false, login: "not_reached", detail: line.slice(0, 200) }); return; }
          greeting = line.slice(0, 200);
          if (!input.password) { finish({ connected: true, login: "skipped" }); return; }
          stage = "login";
          socket.write(`a1 LOGIN ${quoted(input.user)} ${quoted(input.password)}\r\n`);
        } else if (line.startsWith("a1 ")) {
          finish({ connected: true, login: /^a1 OK/i.test(line) ? "ok" : "rejected", detail: line.slice(3, 203) });
          return;
        }
      }
    });
  });
}
