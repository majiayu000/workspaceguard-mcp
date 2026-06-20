#!/usr/bin/env node
import { loadConfig } from "./config/config.js";
import { serveHttp, serveStdio } from "./mcp/server.js";

async function main(): Promise<void> {
  const [command = "serve", ...rest] = process.argv.slice(2);
  if (command === "serve") {
    const config = loadConfig(rest);
    if (config.transport === "stdio") {
      await serveStdio(config);
      return;
    }
    await serveHttp(config);
    return;
  }

  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

function printHelp(): void {
  console.log(`workspaceguard

Usage:
  workspaceguard serve --transport stdio
  workspaceguard serve --transport http --port 8787 --allowed-roots ~/work

Environment:
  WORKSPACEGUARD_TRANSPORT=stdio|http
  WORKSPACEGUARD_BIND_HOST=127.0.0.1
  WORKSPACEGUARD_PORT=8787
  WORKSPACEGUARD_ALLOWED_ROOTS=/path/a,/path/b
  WORKSPACEGUARD_STATE_DIR=~/.workspaceguard
  WORKSPACEGUARD_TOKEN=optional-bearer-token
`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
