/**
 * OIDC token validation middleware for API requests
 */
const axios = require('axios');
const jwt = require('jsonwebtoken');
const { logEvent } = require('../utils/logger');
const config = require('../config');

/**
 * Middleware to verify OIDC access tokens
 */
async function verifyToken(req, res, next) {
  // Skip authentication in test environment
  if (process.env.NODE_ENV === "test" || process.env.JEST_WORKER_ID) {
    return next();
  }

  // Check if OIDC is enabled
  if (!config.oidc || !config.oidc.enabled) {
    logEvent(
      "SECURITY",
      "warning",
      "OIDC authentication is not configured. API is unsecured!"
    );
    return next();
  }
  
  // Get the authorization header
  const authHeader = req.headers.authorization;
  
  // Check if authorization header exists and has Bearer token
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'unauthorized',
        message: 'Authentication required'
      }
    });
  }
  
  try {
    // Extract the token from the authorization header
    const token = authHeader.split(' ')[1];
    
    // Get OIDC issuer URL from config
    const issuerUrl = config.oidc.issuer;
    
    if (!issuerUrl) {
      logEvent(
        "SECURITY",
        "error",
        "OIDC issuer URL not configured"
      );
      
      return res.status(401).json({
        success: false,
        error: {
          code: 'configuration_error',
          message: 'OIDC issuer not configured'
        }
      });
    }
    
    // For performance, we can cache the JWKS discovery
    if (!global.jwksCache || !global.jwksCache.keys || Date.now() - global.jwksCache.timestamp > 3600000) {
      try {
        // Fetch the JWKS (JSON Web Key Set) from the OIDC provider
        logEvent("SECURITY", "info", `Fetching JWKS from ${issuerUrl}`);
        const openidConfig = await axios.get(`${issuerUrl}/.well-known/openid-configuration`);
        const jwksUri = openidConfig.data.jwks_uri;
        const jwksResponse = await axios.get(jwksUri);
        
        // Cache the JWKS
        global.jwksCache = {
          keys: jwksResponse.data.keys,
          timestamp: Date.now()
        };
        
        logEvent("SECURITY", "info", "JWKS fetched and cached successfully");
      } catch (jwksError) {
        logEvent("SECURITY", "error", "Failed to fetch JWKS", { 
          error: jwksError.message,
          issuer: issuerUrl 
        });
        
        return res.status(500).json({
          success: false,
          error: {
            code: 'jwks_fetch_error',
            message: 'Unable to fetch OIDC keys'
          }
        });
      }
    }
    
    // Decode the token without verification first to get the kid (key id)
    const decodedToken = jwt.decode(token, { complete: true });
    if (!decodedToken) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'invalid_token',
          message: 'Invalid token format'
        }
      });
    }
    
    // Find the signing key from the JWKS
    const kid = decodedToken.header.kid;
    const signingKey = global.jwksCache.keys.find(key => key.kid === kid);
    
    if (!signingKey) {
      logEvent("SECURITY", "warning", "Token signing key not found", { kid });
      return res.status(401).json({
        success: false,
        error: {
          code: 'invalid_token',
          message: 'Token signing key not found'
        }
      });
    }
    
    // Create PEM from the signing key's x5c (X.509 Certificate Chain)
    let pem;
    if (signingKey.x5c && signingKey.x5c.length) {
      const cert = signingKey.x5c[0];
      const certBody = cert.match(/.{1,64}/g).join('\n');
      pem = `-----BEGIN CERTIFICATE-----\n${certBody}\n-----END CERTIFICATE-----\n`;
    } else if (signingKey.n && signingKey.e) {
      // If x5c is not available, use n and e to create a public key
      const modulus = Buffer.from(signingKey.n, 'base64url');
      const exponent = Buffer.from(signingKey.e, 'base64url');
      
      const modulusHex = modulus.toString('hex');
      const exponentHex = exponent.toString('hex');
      
      pem = {
        kty: signingKey.kty,
        n: modulusHex,
        e: exponentHex
      };
    } else {
      logEvent("SECURITY", "error", "Unsupported JWK format", { signingKey });
      return res.status(401).json({
        success: false,
        error: {
          code: 'invalid_jwk',
          message: 'Unsupported JWK format'
        }
      });
    }
    
    // Verify the token
    const verified = jwt.verify(token, pem, {
      algorithms: ['RS256', 'RS384', 'RS512'],
      issuer: issuerUrl,
      audience: config.oidc.clientId
    });
    
    // Add the user info to the request for later use
    req.user = {
      id: verified.sub,
      name: verified.name || verified.preferred_username,
      email: verified.email,
      roles: verified.roles || []
    };
    
    logEvent("SECURITY", "info", "Token validated successfully", {
      userId: req.user.id
    });
    
    // Token is valid, continue
    next();
  } catch (error) {
    logEvent("SECURITY", "error", "Token validation error", { error: error.message });
    
    return res.status(401).json({
      success: false,
      error: {
        code: 'unauthorized',
        message: 'Invalid authentication token'
      }
    });
  }
}

module.exports = verifyToken;