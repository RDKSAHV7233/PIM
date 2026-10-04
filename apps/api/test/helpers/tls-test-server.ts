import http from "node:http";
import https from "node:https";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import type { Duplex } from "node:stream";

// Local servers for the real-transport specs. TLS uses the throwaway CA under
// test/fixtures/tls (see its README); nothing here touches the network.

const FIXTURES = path.join(__dirname, "../fixtures/tls");
const read = (name: string) => fs.readFileSync(path.join(FIXTURES, name));

export const TEST_CA = read("ca.crt");
export const REQUIRE_FULL_LOOPBACK = process.env.REQUIRE_FULL_LOOPBACK === "1";

export type RequestHandler = (req: http.IncomingMessage, res: http.ServerResponse) => boolean | void;

export type TestServer = {
  server: http.Server | https.Server;
  port: number;
  host: string;
  tcpConnections: number;
  tlsConnections: number;
  snis: string[];
  hostHeaders: string[];
  requests: Array<{ method?: string; url?: string; headers: http.IncomingHttpHeaders; body: string }>;
  open: Set<Duplex>;
  close(): Promise<void>;
};

function track(server: http.Server | https.Server, state: Omit<TestServer, "server" | "port" | "host" | "close">, onRequest?: RequestHandler) {
  server.on("connection", (s) => {
    state.tcpConnections += 1;
    state.open.add(s);
    s.on("close", () => state.open.delete(s));
  });
  server.on("secureConnection", () => {
    state.tlsConnections += 1;
  });
  server.on("request", (req, res) => {
    state.hostHeaders.push(String(req.headers.host));
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      state.requests.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString("utf8") });
    });
    if (onRequest?.(req, res) === true) return;
    req.resume();
    res.end("ok");
  });
}

function listen(server: http.Server | https.Server, host: string, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve((server.address() as net.AddressInfo).port));
  });
}

function finish(server: http.Server | https.Server, state: Omit<TestServer, "server" | "port" | "host" | "close">, host: string, port: number): TestServer {
  return Object.assign(state, {
    server,
    port,
    host,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  }) as TestServer;
}

const freshState = () => ({
  tcpConnections: 0,
  tlsConnections: 0,
  snis: [] as string[],
  hostHeaders: [] as string[],
  requests: [] as TestServer["requests"],
  open: new Set<Duplex>(),
});

export async function startTlsServer(
  certName: "pin" | "other",
  host: string,
  options: { port?: number; onRequest?: RequestHandler } = {},
): Promise<TestServer> {
  const state = freshState();
  const server = https.createServer({
    key: read(`${certName}.key`),
    cert: read(`${certName}.crt`),
    SNICallback: (servername, cb) => {
      state.snis.push(servername);
      cb(null, undefined);
    },
  });
  track(server, state, options.onRequest);
  const port = await listen(server, host, options.port ?? 0);
  return finish(server, state, host, port);
}

export async function startHttpServer(host: string, options: { onRequest?: RequestHandler } = {}): Promise<TestServer> {
  const state = freshState();
  const server = http.createServer();
  track(server, state, options.onRequest);
  const port = await listen(server, host, 0);
  return finish(server, state, host, port);
}

export async function tryStartTlsServer(
  certName: "pin" | "other",
  host: string,
  options: { port?: number; onRequest?: RequestHandler } = {},
): Promise<TestServer | undefined> {
  try {
    return await startTlsServer(certName, host, options);
  } catch {
    return undefined;
  }
}

/** Fail (instead of silently weakening a proof) when CI demands the full loopback set. */
export function need(value: unknown, what: string): void {
  if (!value && REQUIRE_FULL_LOOPBACK) {
    throw new Error(`REQUIRE_FULL_LOOPBACK=1 but ${what} is unavailable on this machine.`);
  }
}
