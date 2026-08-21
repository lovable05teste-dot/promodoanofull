import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

const AUTOMATION_SIGNATURES = [
  "headlesschrome",
  "phantomjs",
  "selenium",
  "puppeteer",
  "playwright",
  "webdriver",
  "python-requests",
  "python-httpx",
  "aiohttp",
  "scrapy",
  "curl/",
  "wget/",
  "httpclient",
  "libwww-perl",
  "go-http-client",
];

function isDocumentRequest(request: Request): boolean {
  const accept = request.headers.get("accept")?.toLowerCase() ?? "";
  const destination = request.headers.get("sec-fetch-dest")?.toLowerCase() ?? "";
  return destination === "document" || accept.includes("text/html");
}

function hasVerificationCookie(request: Request): boolean {
  const cookie = request.headers.get("cookie") ?? "";
  return cookie.split(";").some((item) => item.trim() === "visitor_verified=1");
}

function renderVerificationPage(): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>Verificando segurança</title>
  <style>
    *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f7f7f7;color:#222;font-family:Arial,sans-serif}.card{width:min(90%,390px);padding:32px;text-align:center;background:#fff;border:1px solid #e5e5e5;border-radius:14px;box-shadow:0 8px 30px rgba(0,0,0,.07)}.spinner{width:42px;height:42px;margin:0 auto 20px;border:4px solid #e8e8e8;border-top-color:#3483fa;border-radius:50%;animation:spin .8s linear infinite}h1{font-size:20px;margin:0 0 8px}p{font-size:14px;color:#666;margin:0}@keyframes spin{to{transform:rotate(360deg)}}
  </style>
</head>
<body>
  <main class="card" aria-live="polite">
    <div class="spinner" aria-hidden="true"></div>
    <h1>Verificando sua conexão</h1>
    <p>Aguarde um instante para continuar.</p>
  </main>
  <script>
    window.setTimeout(function () {
      document.cookie = "visitor_verified=1; Max-Age=86400; Path=/; SameSite=Lax; Secure";
      window.location.reload();
    }, 350);
  </script>
  <noscript>Ative o JavaScript para continuar.</noscript>
</body>
</html>`;
}

function rejectSuspiciousRequest(request: Request): Response | undefined {
  if (!["GET", "HEAD", "POST", "OPTIONS"].includes(request.method)) {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "GET, HEAD, POST, OPTIONS" },
    });
  }

  // Static files and framework requests must remain available. The bot check is
  // applied only when a client asks the server for an HTML document.
  if (!isDocumentRequest(request)) return undefined;

  const userAgent = request.headers.get("user-agent")?.trim().toLowerCase() ?? "";
  const hasAutomationSignature = AUTOMATION_SIGNATURES.some((signature) =>
    userAgent.includes(signature),
  );

  if (!userAgent || hasAutomationSignature) {
    return new Response("Forbidden", {
      status: 403,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
        "x-robots-tag": "noindex, nofollow, noarchive",
      },
    });
  }

  if (request.method === "GET" && !hasVerificationCookie(request)) {
    return new Response(renderVerificationPage(), {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store, private",
        "x-robots-tag": "noindex, nofollow, noarchive",
      },
    });
  }

  return undefined;
}

function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "DENY");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
  headers.set("cross-origin-opener-policy", "same-origin");
  headers.set("x-robots-tag", "noarchive");
  headers.set(
    "content-security-policy",
    [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data: https:",
      "style-src 'self' 'unsafe-inline' https:",
      "script-src 'self' 'unsafe-inline' https://cdn.utmify.com.br https://connect.facebook.net",
      "connect-src 'self' https:",
      "form-action 'self' https:",
      "upgrade-insecure-requests",
    ].join("; "),
  );

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    const rejection = rejectSuspiciousRequest(request);
    if (rejection) return withSecurityHeaders(rejection);

    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return withSecurityHeaders(await normalizeCatastrophicSsrResponse(response));
    } catch (error) {
      console.error(error);
      return withSecurityHeaders(
        new Response(renderErrorPage(), {
          status: 500,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
      );
    }
  },
};
