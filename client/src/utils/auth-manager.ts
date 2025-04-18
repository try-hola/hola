// filepath: /workspaces/hola/client/src/utils/auth-manager.ts
const http = require("http");
const url = require("url");
const open = require("open");
const axios = require("axios");
const crypto = require("crypto");
const keytar = require("keytar");
const configManager = require("./config-manager");
const { outputFormatter } = require("./output-formatter");

/**
 * Manages authentication with the Hola server using OIDC
 */
class AuthManager {
  constructor() {
    this.serviceName = "hola-cli";
  }

  /**
   * Authenticate with the server using OIDC flow
   */
  async authenticate(serverContext) {
    outputFormatter.formatOutput("info", "Starting authentication process...");

    // Determine the auth domain from server context
    const authDomain = serverContext.providerOptions.orbDomain.replace(
      /^[^.]+\./,
      "auth.",
    );
    const authUrl = `https://${authDomain}`;

    // Generate PKCE challenge
    const codeVerifier = this.generateCodeVerifier();
    const codeChallenge = this.generateCodeChallenge(codeVerifier);

    // Start local server to receive callback
    const { server, authorizationPromise } = this.createCallbackServer();

    // Build authorization URL
    const state = crypto.randomBytes(16).toString("hex");
    const authorizationUrl = new URL(`${authUrl}/application/o/authorize/`);
    authorizationUrl.searchParams.append("client_id", serverContext.clientId);
    authorizationUrl.searchParams.append(
      "redirect_uri",
      "http://localhost:8888/callback",
    );
    authorizationUrl.searchParams.append("response_type", "code");
    authorizationUrl.searchParams.append(
      "scope",
      "openid profile email offline_access",
    );
    authorizationUrl.searchParams.append("state", state);
    authorizationUrl.searchParams.append("code_challenge", codeChallenge);
    authorizationUrl.searchParams.append("code_challenge_method", "S256");

    // Open browser for auth
    outputFormatter.formatOutput(
      "info",
      "Opening browser for authentication...",
    );
    await open(authorizationUrl.toString());

    // Wait for callback
    try {
      const { code, responseState } = await authorizationPromise;

      // Validate state
      if (state !== responseState) {
        throw new Error("State mismatch in authentication response");
      }

      // Exchange code for tokens
      const tokenUrl = `${authUrl}/application/o/token/`;
      const tokenResponse = await axios.post(
        tokenUrl,
        new URLSearchParams({
          grant_type: "authorization_code",
          client_id: serverContext.clientId,
          code_verifier: codeVerifier,
          code,
          redirect_uri: "http://localhost:8888/callback",
        }),
      );

      // Store tokens securely
      await this.storeTokens(
        serverContext.name,
        tokenResponse.data.access_token,
        tokenResponse.data.refresh_token,
        tokenResponse.data.expires_in,
      );

      outputFormatter.formatOutput("success", "Authentication successful!");
      return true;
    } catch (error) {
      outputFormatter.formatOutput(
        "error",
        `Authentication failed: ${error.message}`,
      );
      throw error;
    } finally {
      server.close();
    }
  }

  /**
   * Get token for API requests
   */
  async getAccessToken(serverName) {
    const tokens = await this.getTokens(serverName);

    if (!tokens) {
      outputFormatter.formatOutput(
        "error",
        "No authentication tokens found. Please authenticate first.",
      );
      throw new Error("No authentication tokens found");
    }

    // Check if token is expired or close to expiry
    const now = Math.floor(Date.now() / 1000);
    if (tokens.expiresAt - now < 300) {
      // Token expires in less than 5 minutes, refresh it
      return this.refreshToken(serverName, tokens.refreshToken);
    }

    return tokens.accessToken;
  }

  /**
   * Refresh the access token
   */
  async refreshToken(serverName, refreshToken) {
    const serverContext = await configManager.getServerContext(serverName);
    const authDomain = serverContext.providerOptions.orbDomain.replace(
      /^[^.]+\./,
      "auth.",
    );
    const tokenUrl = `https://${authDomain}/application/o/token/`;

    try {
      const response = await axios.post(
        tokenUrl,
        new URLSearchParams({
          grant_type: "refresh_token",
          client_id: serverContext.clientId,
          refresh_token: refreshToken,
        }),
      );

      // Store new tokens
      await this.storeTokens(
        serverName,
        response.data.access_token,
        response.data.refresh_token || refreshToken, // Use new refresh token if provided
        response.data.expires_in,
      );

      return response.data.access_token;
    } catch (error) {
      outputFormatter.formatOutput(
        "error",
        `Failed to refresh token: ${error.message}`,
      );
      outputFormatter.formatOutput("info", "Please authenticate again");
      throw error;
    }
  }

  /**
   * Store tokens securely
   */
  async storeTokens(serverName, accessToken, refreshToken, expiresIn) {
    const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;

    // Store access token, expiry and server name
    await keytar.setPassword(
      this.serviceName,
      `${serverName}_tokens`,
      JSON.stringify({
        accessToken,
        refreshToken,
        expiresAt,
      }),
    );
  }

  /**
   * Get stored tokens
   */
  async getTokens(serverName) {
    const tokens = await keytar.getPassword(
      this.serviceName,
      `${serverName}_tokens`,
    );
    return tokens ? JSON.parse(tokens) : null;
  }

  /**
   * Create local server to handle OAuth callback
   */
  createCallbackServer() {
    const server = http.createServer();

    const authorizationPromise = new Promise((resolveAuth) => {
      server.on("request", (req, res) => {
        const parsedUrl = url.parse(req.url, true);

        if (parsedUrl.pathname === "/callback") {
          // Send response to browser
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(
            "<html><body><h1>Authentication successful!</h1><p>You can close this window and return to the CLI.</p></body></html>",
          );

          // Resolve the promise with the authorization code
          resolveAuth({
            code: parsedUrl.query.code,
            responseState: parsedUrl.query.state,
          });
        }
      });
    });

    server.listen(8888, () => {
      outputFormatter.formatOutput(
        "info",
        "Waiting for authentication callback on port 8888...",
      );
    });

    return { server, authorizationPromise };
  }

  /**
   * Generate PKCE code verifier
   */
  generateCodeVerifier() {
    return crypto.randomBytes(32).toString("base64url");
  }

  /**
   * Generate PKCE code challenge
   */
  generateCodeChallenge(verifier) {
    return crypto.createHash("sha256").update(verifier).digest("base64url");
  }

  /**
   * Generate a secure random string
   */
  generateSecureString(length) {
    return crypto.randomBytes(length).toString("hex");
  }

  /**
   * Log out from the server
   */
  async logout(serverName) {
    await keytar.deletePassword(this.serviceName, `${serverName}_tokens`);
    outputFormatter.formatOutput(
      "success",
      `Logged out from server "${serverName}"`,
    );
  }
}

// Export singleton instance
const authManager = new AuthManager();
module.exports = authManager;
