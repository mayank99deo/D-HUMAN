// A real Postgres wire endpoint for tests, and a proxy that can make its connections go
// silent. Together they reproduce what production's driver meets on Vercel: a pooled
// connection whose network path was dropped while the function slept.
//
// - pgWireServer: the embedded PGlite behind a TCP socket that speaks the Postgres
//   protocol, so postgres.js (the production driver) connects to it as to Supabase.
//   No TLS, and cancel requests are ignored (closed), like pglite-socket.
// - blackholeProxy: forwards bytes to the server until drop() is called. From then on
//   every connection open through it is a black hole, as when a NAT or load balancer
//   forgets an idle flow: whatever the client sends vanishes, nothing comes back and
//   nothing is closed. Connections opened after drop() work normally.
import net from "node:net";
import { PGlite } from "@electric-sql/pglite";

const SSL_REQUEST = 80877103;
const CANCEL_REQUEST = 80877102;

export type WireServer = { port: number; db: PGlite; close(): Promise<void> };

export async function pgWireServer(given?: PGlite): Promise<WireServer> {
  const db = given ?? new PGlite();
  await db.waitReady;
  // PGlite is one session, shared by every connection. So one connection at a time holds
  // it, from its first message until Postgres says it's idle again (ReadyForQuery "I"):
  // postgres.js often sends Parse and Describe, waits for the answer, then Bind and
  // Execute, and a transaction spans many exchanges. Another connection's messages wait,
  // so they can't land in the middle and take over its statement or its transaction.
  // Code that waits on a second connection inside a transaction would wait here until its
  // query deadline; real Postgres would run that second query.
  const sockets = new Set<net.Socket>();
  const queue: { socket: net.Socket; batch: Buffer[] }[] = [];
  let owner: net.Socket | null = null;
  let busy = false;

  function pump() {
    if (busy) return;
    const i = queue.findIndex((q) => !owner || q.socket === owner);
    if (i < 0) return;
    const [{ socket, batch }] = queue.splice(i, 1);
    busy = true;
    owner = socket;
    let tail = Buffer.alloc(0);
    db.runExclusive(async () => {
      for (const message of batch) {
        await db.execProtocolRawStream(new Uint8Array(message), {
          onRawData: (data) => {
            tail = Buffer.concat([tail, Buffer.from(data)]).subarray(-6);
            if (socket.writable) socket.write(Buffer.from(data));
          },
        });
      }
    })
      .catch(() => socket.destroy())
      .finally(() => {
        // ReadyForQuery ("Z", length 5, status) ends every exchange; "I" means idle.
        const idle = tail.length === 6 && tail[0] === 0x5a && tail.readInt32BE(1) === 5 && tail[5] === 0x49;
        if (idle || socket.destroyed) owner = null;
        busy = false;
        pump();
      });
  }

  async function release(socket: net.Socket) {
    for (let i = queue.length - 1; i >= 0; i--) if (queue[i].socket === socket) queue.splice(i, 1);
    if (owner !== socket) return;
    // Gone in the middle of a transaction: end it, as Postgres does when a connection drops.
    if (!busy) await db.runExclusive(() => db.exec("ROLLBACK")).catch(() => {});
    owner = null;
    pump();
  }

  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.setNoDelay(true);
    socket.on("close", () => {
      sockets.delete(socket);
      void release(socket);
    });
    socket.on("error", () => {});
    let buffer = Buffer.alloc(0);
    let started = false;

    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const batch: Buffer[] = [];
      for (;;) {
        if (!started) {
          if (buffer.length < 8) break;
          const length = buffer.readInt32BE(0);
          if (buffer.length < length) break;
          const code = buffer.readInt32BE(4);
          const message = buffer.subarray(0, length);
          buffer = buffer.subarray(length);
          if (code === SSL_REQUEST) {
            socket.write("N");
            continue;
          }
          if (code === CANCEL_REQUEST) {
            socket.end();
            return;
          }
          started = true;
          batch.push(message);
          continue;
        }
        if (buffer.length < 5) break;
        const length = 1 + buffer.readInt32BE(1);
        if (buffer.length < length) break;
        // Terminate ("X"): Postgres closes the connection, and the client waits for that.
        if (buffer[0] === 0x58) {
          buffer = Buffer.alloc(0);
          if (batch.length) queue.push({ socket, batch: batch.splice(0) });
          pump();
          socket.end();
          return;
        }
        batch.push(buffer.subarray(0, length));
        buffer = buffer.subarray(length);
      }
      if (!batch.length) return;
      queue.push({ socket, batch });
      pump();
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: (server.address() as net.AddressInfo).port,
    db,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
      await db.close();
    },
  };
}

export type BlackholeProxy = {
  port: number;
  /** Every connection open now goes silent for good. New ones work. */
  drop(): void;
  /** Connections currently open through the proxy. */
  readonly open: number;
  close(): Promise<void>;
};

export async function blackholeProxy(targetPort: number): Promise<BlackholeProxy> {
  type Flow = { client: net.Socket; upstream: net.Socket; dead: boolean };
  const flows = new Set<Flow>();

  const server = net.createServer((client) => {
    const upstream = net.connect(targetPort, "127.0.0.1");
    const flow: Flow = { client, upstream, dead: false };
    flows.add(flow);
    client.on("data", (data) => {
      if (!flow.dead) upstream.write(data);
    });
    upstream.on("data", (data) => {
      if (!flow.dead) client.write(data);
    });
    client.on("close", () => {
      flows.delete(flow);
      upstream.destroy();
    });
    upstream.on("close", () => {
      if (!flow.dead) client.destroy();
    });
    client.on("error", () => {});
    upstream.on("error", () => {});
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: (server.address() as net.AddressInfo).port,
    drop() {
      for (const flow of flows) flow.dead = true;
    },
    get open() {
      return flows.size;
    },
    async close() {
      for (const flow of flows) {
        flow.client.destroy();
        flow.upstream.destroy();
      }
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
