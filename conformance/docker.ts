// The container route (docs/01 §3.3 option B): the suite runs on an internal Docker network with no
// way out. A gateway container on that network answers to the given host names on ports 80 and 443
// and forwards raw TCP to the sandbox fronts on the host. TLS ends at the host front, which serves
// the test certificate.
import { randomBytes } from "node:crypto";
import { userInfo } from "node:os";
import { type ExecResult, exec, mustExec, type Sandbox, startSandbox } from "./harness.ts";

/** Images by digest, so a moved tag cannot change a stamped run. */
export const IMAGES = {
  gateway: "node:24-alpine@sha256:50c8e8ca1d27439048670df5883f32d57cf81cff6233222c893fd0d9884cbd81",
  node20: "node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293",
  php: "php:8.3-cli@sha256:c0a895aa6dd7d195c3312e95ed20b74122557a76f1c7e5dc28db4bfa6a401b6f",
  maven:
    "maven:3.9-eclipse-temurin-17@sha256:1e539ad894cb86c5b87a9c81223732a90c6cb7c23e4ac206c2cea892538fd8d7",
} as const;

/** A public address for egress probes: on the internal network, a connection must be unreachable. */
export const PUBLIC_IP = "1.1.1.1";

/** Every network and container a runner creates carries this label, for manual cleanup. */
const LABEL = "postmock-conformance";

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

/**
 * Arguments of `docker run` for a container on `network`.
 * The container runs as the host user, so files it writes to a mount stay removable.
 */
function dockerRunArgs(spec: ContainerRun, network: string): string[] {
  const { uid, gid } = userInfo();
  return [
    "run",
    "--rm",
    "--label",
    LABEL,
    "--user",
    `${uid}:${gid}`,
    "--network",
    network,
    ...Object.entries(spec.mounts ?? {}).flatMap(([host, inside]) => ["-v", `${host}:${inside}`]),
    ...Object.entries({ HOME: "/tmp", ...spec.env }).flatMap(([key, value]) => [
      "-e",
      `${key}=${value}`,
    ]),
    ...(spec.workdir === undefined ? [] : ["-w", spec.workdir]),
    spec.image,
    ...spec.command,
  ];
}

/**
 * Runs a container outside the sandbox: on the default network for installs that need a package
 * registry, or on `none`.
 */
export const runContainer = (spec: ContainerRun, network: "bridge" | "none") =>
  exec("docker", dockerRunArgs(spec, network), { quiet: spec.quiet ?? false });

export interface ContainerSandbox {
  sandbox: Sandbox;
  /** Runs a container on the internal network. */
  run(spec: ContainerRun): Promise<ExecResult>;
}

/**
 * Starts a sandbox and an internal network whose gateway answers to `aliases`, runs `use`, and
 * removes everything afterwards, also on SIGINT and SIGTERM.
 */
export async function withContainerSandbox<T>(
  options: { sdk: string; aliases: readonly string[]; tls?: { cert: string; key: string } },
  use: (sandbox: ContainerSandbox) => Promise<T>,
): Promise<T> {
  const name = `postmock-${options.sdk.replace(/[^a-z0-9]/gi, "-")}-${randomBytes(4).toString("hex")}`;
  const gateway = `${name}-gateway`;
  const sandbox = await startSandbox(options.tls ? { tls: options.tls } : {});
  const removeDocker = async () => {
    // A suite container ignores the signal its `docker run` client forwards (PID 1 has no handler),
    // so remove every container on the network, not only the gateway.
    const attached = await exec("docker", ["ps", "-aq", "--filter", `network=${name}`], {
      quiet: true,
    });
    const containers = attached.output.split("\n").filter((id) => /^[0-9a-f]+$/.test(id));
    for (const args of [
      ...(containers.length > 0 ? [["rm", "-f", ...containers]] : []),
      ["rm", "-f", gateway],
      ["network", "rm", name],
    ]) {
      const { code, output } = await exec("docker", args, { quiet: true });
      if (code !== 0 && !/No such|not found/i.test(output)) {
        console.error(`postmock: docker ${args.join(" ")} failed: ${output.trim()}`);
      }
    }
  };
  const onSignal = (signal: NodeJS.Signals) => {
    void removeDocker().finally(() => process.exit(signal === "SIGINT" ? 130 : 143));
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  try {
    const quiet = { quiet: true };
    await mustExec("docker", ["network", "create", "--internal", "--label", LABEL, name], quiet);
    await mustExec(
      "docker",
      [
        "run",
        "-d",
        "--rm",
        "--label",
        LABEL,
        "--name",
        gateway,
        "--add-host",
        "host.docker.internal:host-gateway",
        "-e",
        `HTTP_PORT=${sandbox.httpPort}`,
        ...(sandbox.httpsPort === undefined ? [] : ["-e", `HTTPS_PORT=${sandbox.httpsPort}`]),
        IMAGES.gateway,
        "node",
        "-e",
        GATEWAY_SCRIPT,
      ],
      quiet,
    );
    await mustExec(
      "docker",
      ["network", "connect", ...options.aliases.flatMap((a) => ["--alias", a]), name, gateway],
      quiet,
    );
    await waitForGateway(gateway, sandbox.httpPort);
    return await use({
      sandbox,
      run: (spec) => exec("docker", dockerRunArgs(spec, name), { quiet: spec.quiet ?? false }),
    });
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    await removeDocker();
    await sandbox.close();
  }
}

/**
 * Waits until the gateway listens on port 80, then checks that it reaches the host front. A TCP
 * connect proves the path without a request, so the front's request count stays at zero.
 */
async function waitForGateway(gateway: string, hostPort: number): Promise<void> {
  const connect = (host: string, port: number) =>
    `require("node:net").connect(${port}, "${host}").on("connect", () => process.exit(0)).on("error", (e) => { console.error(e.message); process.exit(1); })`;
  for (let attempt = 0; attempt < 40; attempt++) {
    const { code } = await exec(
      "docker",
      ["exec", gateway, "node", "-e", connect("127.0.0.1", 80)],
      {
        quiet: true,
      },
    );
    if (code === 0) {
      const reach = await exec(
        "docker",
        ["exec", gateway, "node", "-e", connect("host.docker.internal", hostPort)],
        { quiet: true },
      );
      if (reach.code !== 0) {
        throw new Error(
          `gateway cannot reach the sandbox front at host.docker.internal:${hostPort} (${reach.output.trim()}); see TESTING.md traps`,
        );
      }
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`gateway ${gateway} did not listen on port 80`);
}
