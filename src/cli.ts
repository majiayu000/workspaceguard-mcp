#!/usr/bin/env node
import { loadConfig, loadProxyConfig } from "./config/config.js";
import { serveHttp, serveStdio } from "./mcp/server.js";
import { serveSecureProxy } from "./proxy/secure-proxy.js";

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

  if (command === "proxy") {
    const config = loadProxyConfig(rest);
    await serveSecureProxy(config);
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
  workspaceguard serve --transport http --port 8787 --allowed-roots ~/work --bearer-token long-random-token
  workspaceguard serve --transport http --auth-mode oauth-dev --public-base-url https://example.com --oauth-approval-code local-code
  workspaceguard proxy --target-url http://127.0.0.1:8787/mcp --target-bearer-token local-token --auth-mode oauth-dev --public-base-url https://example.com --oauth-approval-code local-code

Environment:
  WORKSPACEGUARD_TRANSPORT=stdio|http
  WORKSPACEGUARD_AUTH_MODE=bearer|oauth-dev
  WORKSPACEGUARD_BIND_HOST=127.0.0.1
  WORKSPACEGUARD_PORT=8787
  WORKSPACEGUARD_ALLOWED_ROOTS=/path/a,/path/b
  WORKSPACEGUARD_ALLOWED_ORIGINS=https://chatgpt.com,https://example.com
  WORKSPACEGUARD_STATE_DIR=~/.workspaceguard
  WORKSPACEGUARD_TOKEN=required-for-http
  WORKSPACEGUARD_PUBLIC_BASE_URL=https://your-public-host.example
  WORKSPACEGUARD_OAUTH_APPROVAL_CODE=local-human-approval-code
  WORKSPACEGUARD_OAUTH_PUBLIC_CLIENTS=https://chatgpt.com/oauth/client.json|https://chatgpt.com/oauth/callback
  WORKSPACEGUARD_PROXY_TARGET_URL=http://127.0.0.1:8787/mcp
  WORKSPACEGUARD_PROXY_TARGET_TOKEN=local-workspaceguard-token
`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
