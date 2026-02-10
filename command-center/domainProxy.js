/**
 * domainProxy — Firebase Cloud Function for Command Center
 * 
 * Proxies domain registrar API calls from the browser to avoid CORS restrictions.
 * Supports Porkbun and GoDaddy APIs.
 * 
 * DEPLOYMENT:
 *   1. Add this export to your existing functions/index.js
 *   2. Run: firebase deploy --only functions:domainProxy
 * 
 * USAGE FROM CC:
 *   POST https://us-central1-word-boxing.cloudfunctions.net/domainProxy
 *   Body: {
 *     "provider": "porkbun" | "godaddy",
 *     "endpoint": "/dns/retrieve/example.com",
 *     "method": "POST" | "GET" | "PUT" | "PATCH",
 *     "body": { ... },         // Request body (for POST/PUT/PATCH)
 *     "headers": { ... }       // Extra headers (for GoDaddy auth)
 *   }
 * 
 * SECURITY:
 *   - API keys are sent by the browser per-request (not stored in function)
 *   - CORS is configured to allow requests from any origin (CC runs from file:// and github.io)
 *   - The function only proxies to known registrar API hosts
 * 
 * Add to your existing functions/index.js:
 *   const { domainProxy } = require('./domainProxy');
 *   exports.domainProxy = domainProxy;
 * 
 * OR if you prefer, paste the export directly into index.js.
 */

const functions = require("firebase-functions");
const fetch = require("node-fetch");

// Allowed API hosts — the function will ONLY proxy to these
const ALLOWED_HOSTS = {
    porkbun: "https://api.porkbun.com/api/json/v3",
    godaddy: "https://api.godaddy.com/v1",
};

exports.domainProxy = functions.https.onRequest(async (req, res) => {
    // CORS headers — allow any origin (CC runs from file://, localhost, github.io)
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");

    // Handle preflight
    if (req.method === "OPTIONS") {
        res.status(204).send("");
        return;
    }

    // Only accept POST
    if (req.method !== "POST") {
        res.status(405).json({ status: "ERROR", message: "Method not allowed. Use POST." });
        return;
    }

    try {
        const { provider, endpoint, method, body, headers } = req.body;

        // Validate provider
        if (!provider || !ALLOWED_HOSTS[provider]) {
            res.status(400).json({
                status: "ERROR",
                message: `Invalid provider: ${provider}. Supported: ${Object.keys(ALLOWED_HOSTS).join(", ")}`,
            });
            return;
        }

        // Validate endpoint
        if (!endpoint || typeof endpoint !== "string" || endpoint.includes("..")) {
            res.status(400).json({ status: "ERROR", message: "Invalid endpoint" });
            return;
        }

        // Build target URL
        const targetUrl = `${ALLOWED_HOSTS[provider]}${endpoint}`;
        const httpMethod = (method || "POST").toUpperCase();

        // Build fetch options
        const fetchOptions = {
            method: httpMethod,
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json",
                ...(headers || {}),
            },
        };

        // Add body for POST/PUT/PATCH
        if (body && ["POST", "PUT", "PATCH"].includes(httpMethod)) {
            fetchOptions.body = JSON.stringify(body);
        }

        // Make the proxied request
        const response = await fetch(targetUrl, fetchOptions);
        const responseText = await response.text();

        // Try to parse as JSON
        let responseData;
        try {
            responseData = JSON.parse(responseText);
        } catch {
            responseData = { rawResponse: responseText };
        }

        // Return with original status code
        res.status(response.status).json(responseData);
    } catch (error) {
        console.error("domainProxy error:", error);
        res.status(500).json({
            status: "ERROR",
            message: `Proxy error: ${error.message}`,
        });
    }
});
