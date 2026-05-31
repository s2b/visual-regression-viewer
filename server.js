#!/usr/bin/env node

const fs = require("fs");
const fsp = require("fs/promises");
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");
const { pipeline } = require("stream");

const DEFAULT_PORT = 3030;
const DEFAULT_HOST = "127.0.0.1";
const ROOT = __dirname;
const DEFAULT_REPORT_PATHS = [
  "visualregression.report.json",
  "visual-regression-results/visualregression.report.json",
];

function printHelp() {
  console.log(`Visual Regression Viewer

Usage:
  visual-regression-viewer [visualregression.report.json] [options]

Arguments:
  report.json           Path to the report JSON file. If omitted, the viewer
                        checks these paths from the current directory:
                        ${DEFAULT_REPORT_PATHS.join("\n                        ")}

Options:
  -p, --port <number>   Port to listen on. Default: ${DEFAULT_PORT}
  --host <host>         Host/IP to bind to. Default: ${DEFAULT_HOST}
                        Use 0.0.0.0 to allow access from other computers.
  --no-open             Do not open the viewer in the default browser.
  -h, --help            Show this help message.
`);
}

function parseArgs(argv) {
  const args = {
    host: DEFAULT_HOST,
    open: true,
    port: DEFAULT_PORT,
    reportPath: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }

    if (arg === "--port" || arg === "-p") {
      index += 1;
      args.port = Number(argv[index]);
      continue;
    }

    if (arg.startsWith("--port=")) {
      args.port = Number(arg.slice("--port=".length));
      continue;
    }

    if (arg === "--host") {
      index += 1;
      args.host = argv[index];
      continue;
    }

    if (arg.startsWith("--host=")) {
      args.host = arg.slice("--host=".length);
      continue;
    }

    if (arg === "--no-open") {
      args.open = false;
      continue;
    }

    if (!args.reportPath) args.reportPath = arg;
  }

  if (typeof args.host !== "string" || !args.host.trim()) {
    console.error("Invalid host. Use an IP address or hostname.");
    process.exit(1);
  }
  args.host = args.host.trim();

  if (!Number.isInteger(args.port) || args.port < 1 || args.port > 65535) {
    console.error(`Invalid port. Use a number between 1 and 65535.`);
    process.exit(1);
  }

  return args;
}

function openBrowser(url) {
  const opener = process.platform === "darwin"
    ? { command: "open", args: [url] }
    : process.platform === "win32"
      ? { command: "cmd", args: ["/c", "start", "", url] }
      : { command: "xdg-open", args: [url] };

  const child = spawn(opener.command, opener.args, {
    detached: true,
    stdio: "ignore",
  });

  child.on("error", (error) => {
    console.warn(`Could not open browser automatically: ${error.message}`);
  });
  child.unref();
}

const cliArgs = parseArgs(process.argv.slice(2));
const PORT = cliArgs.port;
const HOST = cliArgs.host;
const REPORT_PATH = cliArgs.reportPath
  ? path.resolve(process.cwd(), cliArgs.reportPath)
  : DEFAULT_REPORT_PATHS.map((reportPath) => path.resolve(process.cwd(), reportPath))
    .find((reportPath) => fs.existsSync(reportPath)) || path.resolve(process.cwd(), DEFAULT_REPORT_PATHS[0]);
const REPORT_DIR = path.dirname(REPORT_PATH);
const PUBLIC_DIR = path.join(ROOT, "public");

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
};

const noCacheHeaders = {
  "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  "pragma": "no-cache",
  "expires": "0",
  "surrogate-control": "no-store",
};

async function readReport() {
  const raw = await fsp.readFile(REPORT_PATH, "utf8");
  return JSON.parse(raw);
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    ...noCacheHeaders,
  });
  res.end(payload);
}

function text(res, status, message) {
  res.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    ...noCacheHeaders,
  });
  res.end(message);
}

async function readJsonBody(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 1024 * 1024) {
      throw Object.assign(new Error("Request body too large"), { status: 413 });
    }
  }
  return body ? JSON.parse(body) : {};
}

function filePathFromUrl(root, urlPath, fallback = null) {
  const pathname = fallback && urlPath === "/" ? fallback : urlPath;
  const decoded = decodeURIComponent(pathname);
  const resolved = path.resolve(root, `.${decoded}`);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
  return resolved;
}

async function serveFile(req, res, file) {
  if (!file) {
    text(res, 403, "Forbidden");
    return;
  }

  try {
    const stat = await fsp.stat(file);
    if (!stat.isFile()) {
      text(res, 404, "Not found");
      return;
    }

    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      "content-type": contentTypes[ext] || "application/octet-stream",
      "content-length": stat.size,
      ...noCacheHeaders,
    });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    pipeline(fs.createReadStream(file), res, (error) => {
      if (error) console.error(error);
    });
  } catch (error) {
    if (error.code === "ENOENT") {
      text(res, 404, "Not found");
      return;
    }
    console.error(error);
    text(res, 500, "Internal server error");
  }
}

async function serveStatic(req, res, url) {
  await serveFile(req, res, filePathFromUrl(PUBLIC_DIR, url.pathname, "/index.html"));
}

async function serveReport(req, res) {
  await serveFile(req, res, REPORT_PATH);
}

async function serveScreenshot(req, res, url) {
  const relativePath = url.pathname.slice("/screenshots".length) || "/";
  await serveFile(req, res, filePathFromUrl(REPORT_DIR, relativePath));
}

async function patchTest(req, res, identifier) {
  if (typeof identifier !== "string" || !identifier) {
    json(res, 400, { error: "Invalid test identifier" });
    return;
  }

  const body = await readJsonBody(req);
  const updates = {};

  if ("accepted" in body) {
    if (typeof body.accepted !== "boolean") {
      json(res, 400, { error: "accepted must be a boolean" });
      return;
    }
    updates.accepted = body.accepted;
  }

  if ("status" in body) {
    if (typeof body.status !== "string" || !body.status.trim()) {
      json(res, 400, { error: "status must be a non-empty string" });
      return;
    }
    updates.status = body.status.trim();
  }

  if ("updateScreenshotReference" in body) {
    if (typeof body.updateScreenshotReference !== "boolean") {
      json(res, 400, { error: "updateScreenshotReference must be a boolean" });
      return;
    }
    updates.updateScreenshotReference = body.updateScreenshotReference;
  }

  if (!Object.keys(updates).length) {
    json(res, 400, { error: "No supported test updates provided" });
    return;
  }

  const report = await readReport();
  const index = Array.isArray(report.tests)
    ? report.tests.findIndex((test) => String(test.identifier || "") === identifier)
    : -1;
  if (index === -1) {
    json(res, 404, { error: "Test not found" });
    return;
  }

  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) delete report.tests[index][key];
    else report.tests[index][key] = value;
  }
  await fsp.writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  json(res, 200, { test: { ...report.tests[index], id: String(report.tests[index].identifier || "") } });
}

async function acceptPassedTests(req, res) {
  const body = await readJsonBody(req);
  if (body.accepted !== undefined && body.accepted !== true) {
    json(res, 400, { error: "accepted must be true when provided" });
    return;
  }

  const report = await readReport();
  const updated = [];
  if (Array.isArray(report.tests)) {
    report.tests.forEach((test) => {
      if (test.status !== "passed" || test.accepted || test.updateScreenshotReference) return;
      test.accepted = true;
      updated.push({ ...test, id: String(test.identifier || "") });
    });
  }

  if (updated.length) {
    await fsp.writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  }

  json(res, 200, { updated: updated.length, tests: updated });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  try {
    if ((req.method === "GET" || req.method === "HEAD") && url.pathname === "/report") {
      await serveReport(req, res);
      return;
    }

    if ((req.method === "GET" || req.method === "HEAD") && url.pathname.startsWith("/screenshots/")) {
      await serveScreenshot(req, res, url);
      return;
    }

    if (req.method === "PATCH" && url.pathname === "/tests/accept-passed") {
      await acceptPassedTests(req, res);
      return;
    }

    const testMatch = url.pathname.match(/^\/tests\/(.+)$/);
    if (req.method === "PATCH" && testMatch) {
      await patchTest(req, res, decodeURIComponent(testMatch[1]));
      return;
    }

    if (req.method === "GET" || req.method === "HEAD") {
      await serveStatic(req, res, url);
      return;
    }

    text(res, 405, "Method not allowed");
  } catch (error) {
    if (error instanceof SyntaxError) {
      json(res, 400, { error: "Invalid JSON" });
      return;
    }
    if (error.status) {
      json(res, error.status, { error: error.message });
      return;
    }
    console.error(error);
    json(res, 500, { error: "Internal server error" });
  }
});

server.listen(PORT, HOST, () => {
  const url = `http://${HOST}:${PORT}`;
  console.log(`Visual regression viewer running at ${url}`);
  console.log(`Serving report from ${REPORT_PATH}`);
  if (cliArgs.open) openBrowser(url);
});
