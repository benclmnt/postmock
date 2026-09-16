// The container route (docs/01 §3.3 option B): the suite runs on an internal Docker network with no
// way out. A gateway container on that network answers to the given host names on ports 80 and 443
// and forwards raw TCP to the sandbox fronts on the host. TLS ends at the host front, which serves
// the test certificate.
import { randomBytes } from "node:crypto";
import { type ExecResult, exec, mustExec, type Sandbox } from "./harness.ts";

const GATEWAY_IMAGE = "node:24-alpine";

/** A public address for egress probes: on the internal network, a connection must be unreachable. */
export const PUBLIC_IP = "1.1.1.1";

// Runs inside the gateway: port 80 → host http front, port 443 → host TLS front.
const GATEWAY_SCRIPT = `
const net = require("node:net");
const target = "host.docker.internal";
for (const [port, to] of [[80, process.env.HTTP_PORT], [443, process.env.HTTPS_PORT]]) {
  if (!to) continue;
  net.createServer((client) => {
    const upstream = net.connect(Number(to), target);
    client.pipe(upstream).pipe(client);
    client.on("error", () => upstream.destroy());
    upstream.on("error", () => client.destroy());
  }).listen(port);
}
`;

export interface ContainerRun {
  image: string;
  command: readonly string[];
  /** `host path → container path`. */
  mounts?: Readonly<Record<string, string>>;
  env?: Readonly<Record<string, string>>;
  workdir?: string;
  quiet?: boolean;
}

export interface DockerSandbox {
  network: string;
  /** Runs a container on the internal network. */
  run(spec: ContainerRun): Promise<ExecResult>;
  close(): Promise<void>;
}

/** Arguments of `docker run` for a container on `network` (or the default network when absent). */
export function dockerRunArgs(spec: ContainerRun, network?: string): string[] {
  return [
    "run",
    "--rm",
    ...(network === undefined ? [] : ["--network", network]),
    ...Object.entries(spec.mounts ?? {}).flatMap(([host, inside]) => ["-v", `${host}:${inside}`]),
    ...Object.entries(spec.env ?? {}).flatMap(([key, value]) => ["-e", `${key}=${value}`]),
    ...(spec.workdir === undefined ? [] : ["-w", spec.workdir]),
    spec.image,
    ...spec.command,
  ];
}

/** Runs a container on the default network: installs that need a package registry. */
export const runOnline = (spec: ContainerRun) =>
  exec("docker", dockerRunArgs(spec), { quiet: spec.quiet ?? false });

/** `aliases` are the host names the gateway answers to on the internal network. */
export async function startDockerSandbox(
  sandbox: Sandbox,
  sdk: string,
  aliases: readonly string[],
): Promise<DockerSandbox> {
  const name = `postmock-${sdk.replace(/[^a-z0-9]/gi, "-")}-${randomBytes(4).toString("hex")}`;
  const gateway = `${name}-gateway`;
  const quiet = { quiet: true };
  await mustExec("docker", ["network", "create", "--internal", name], quiet);
  const close = async () => {
    await exec("docker", ["rm", "-f", gateway], quiet);
    await exec("docker", ["network", "rm", name], quiet);
  };
  try {
    await mustExec(
      "docker",
      [
        "run",
        "-d",
        "--rm",
        "--name",
        gateway,
        "--add-host",
        "host.docker.internal:host-gateway",
        "-e",
        `HTTP_PORT=${sandbox.httpPort}`,
        ...(sandbox.httpsPort === undefined ? [] : ["-e", `HTTPS_PORT=${sandbox.httpsPort}`]),
        GATEWAY_IMAGE,
        "node",
        "-e",
        GATEWAY_SCRIPT,
      ],
      quiet,
    );
    await mustExec(
      "docker",
      ["network", "connect", ...aliases.flatMap((a) => ["--alias", a]), name, gateway],
      quiet,
    );
    await waitForGateway(gateway);
  } catch (error) {
    await close();
    throw error;
  }
  return {
    network: name,
    run: (spec) => exec("docker", dockerRunArgs(spec, name), { quiet: spec.quiet ?? false }),
    close,
  };
}

async function waitForGateway(gateway: string): Promise<void> {
  const check = `require("node:net").connect(80, "127.0.0.1").on("connect", () => process.exit(0)).on("error", () => process.exit(1))`;
  for (let attempt = 0; attempt < 40; attempt++) {
    const { code } = await exec("docker", ["exec", gateway, "node", "-e", check], { quiet: true });
    if (code === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`gateway ${gateway} did not listen on port 80`);
}
