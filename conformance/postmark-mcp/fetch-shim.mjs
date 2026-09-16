// Preloaded with `node --import` into the smoke tests and every Node process they spawn.
// postmark-mcp calls the global fetch with a hard-coded host (sdk/postmark-mcp/index.js:19,97), so
// replacing fetch routes every call to postmock. Any other host throws: nothing reaches the network.
import childProcess from "node:child_process";

const target = new URL(process.env.POSTMOCK_API_URL);
const realFetch = globalThis.fetch;

globalThis.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.hostname !== "api.postmarkapp.com") {
    throw new Error(`postmock fetch shim: refusing a request to ${url.origin}`);
  }
  url.protocol = target.protocol;
  url.host = target.host;
  return realFetch(input instanceof Request ? new Request(url, input) : url, init);
};

// The MCP stdio transport spawns the server with a filtered env that drops NODE_OPTIONS
// (@modelcontextprotocol/sdk client/stdio.js getDefaultEnvironment). Put the shim back.
const realSpawn = childProcess.spawn;
childProcess.spawn = (command, args, options) => {
  const routed = {
    NODE_OPTIONS: process.env.NODE_OPTIONS,
    POSTMOCK_API_URL: process.env.POSTMOCK_API_URL,
  };
  if (!Array.isArray(args)) {
    return realSpawn(command, { ...args, env: { ...(args?.env ?? process.env), ...routed } });
  }
  return realSpawn(command, args, {
    ...options,
    env: { ...(options?.env ?? process.env), ...routed },
  });
};
