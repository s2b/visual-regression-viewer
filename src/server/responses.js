import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream";
import { HttpError } from "./errors.js";

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
};

const noCacheHeaders = {
  "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  "pragma": "no-cache",
  "expires": "0",
};

export function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    ...noCacheHeaders,
  });
  res.end(payload);
}

export function text(res, status, message) {
  res.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    ...noCacheHeaders,
  });
  res.end(message);
}

export function file(req, res, filePath, stat) {
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    "content-type": contentTypes[ext] || "application/octet-stream",
    "content-length": stat.size,
    ...noCacheHeaders,
  });

  if (req.method === "HEAD") {
    res.end();
    return;
  }

  pipeline(fs.createReadStream(filePath), res, (streamError) => {
    if (streamError) {
      console.error(streamError);
    }
  });
}

export function error(res, error, format) {
  if (error instanceof SyntaxError) {
    json(res, 400, { error: "Invalid JSON" });
    return;
  }

  if (error instanceof HttpError) {
    if (error.status >= 500) {
      console.error(error.cause || error);
    }
    if (format === "text") {
      text(res, error.status, error.message);
    } else {
      json(res, error.status, { error: error.message });
    }
    return;
  }

  console.error(error);
  if (format === "text") {
    text(res, 500, "Internal server error");
  } else {
    json(res, 500, { error: "Internal server error" });
  }
}
