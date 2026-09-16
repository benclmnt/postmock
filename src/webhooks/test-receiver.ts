import { once } from "node:events";
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";

export interface Received {
  path: string;
  headers: IncomingHttpHeaders;
  body: string;
}

/**
 * A local HTTP endpoint for webhook tests. `answer` picks the status per request (a 3xx with a
 * `location` redirects). Close it after the test.
 */
export async function startReceiver(
  answer: (req: Received) => number | { redirect: string } = () => 200,
) {
  const received: Received[] = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const entry = {
      path: req.url ?? "",
      headers: req.headers,
      body: Buffer.concat(chunks).toString(),
    };
    received.push(entry);
    const reply = answer(entry);
    if (typeof reply === "number") res.writeHead(reply).end();
    else res.writeHead(307, { Location: reply.redirect }).end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    received,
    close: () =>
      new Promise<void>((done) => {
        server.close(() => done());
        server.closeAllConnections();
      }),
  };
}
