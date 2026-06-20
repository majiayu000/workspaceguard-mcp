import { OAuthDevProvider } from "./oauth-dev-provider.js";
import type { HttpAuthMode, WorkspaceGuardConfig, WorkspaceGuardProxyConfig } from "../config/config.js";
import { authorizeBearer } from "../mcp/http-security.js";

export interface HttpAuthenticator {
  readonly mode: HttpAuthMode;
  readonly oauthProvider?: OAuthDevProvider;
  authorize(header: string | undefined): boolean;
  challengeHeader(): string | undefined;
}

type AuthConfig = Pick<
  WorkspaceGuardConfig | WorkspaceGuardProxyConfig,
  "authMode" | "bearerToken" | "publicBaseUrl" | "oauthApprovalCode" | "oauthScopes"
>;

export function createHttpAuthenticator(config: AuthConfig): HttpAuthenticator {
  if (config.authMode === "bearer") {
    return {
      mode: "bearer",
      authorize: (header) => authorizeBearer(header, config.bearerToken),
      challengeHeader: () => undefined,
    };
  }

  if (config.publicBaseUrl === undefined || config.oauthApprovalCode === undefined) {
    throw new Error("OAuth dev auth requires publicBaseUrl and oauthApprovalCode.");
  }

  const oauthProvider = new OAuthDevProvider({
    publicBaseUrl: config.publicBaseUrl,
    approvalCode: config.oauthApprovalCode,
    scopes: config.oauthScopes,
  });
  return {
    mode: "oauth-dev",
    oauthProvider,
    authorize: (header) => oauthProvider.verifyBearerHeader(header),
    challengeHeader: () => oauthProvider.wwwAuthenticateHeader(),
  };
}
