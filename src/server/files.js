import fsp from "node:fs/promises";
import path from "node:path";
import { HttpError } from "./errors.js";
import { file as fileResponse } from "./responses.js";

export function filePathFromUrl(root, urlPath, fallback = null) {
  const pathname = fallback && urlPath === "/" ? fallback : urlPath;
  const decoded = decodeURIComponent(pathname);
  const resolved = path.resolve(root, `.${decoded}`);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    return null;
  }
  return resolved;
}

export async function serveFile(req, res, file) {
  if (!file) {
    throw new HttpError(403, "Forbidden");
  }

  try {
    const stat = await fsp.stat(file);
    if (!stat.isFile()) {
      throw new HttpError(404, "Not found");
    }

    fileResponse(req, res, file, stat);
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }
    if (error.code === "ENOENT") {
      throw new HttpError(404, "Not found");
    }
    throw new HttpError(500, "Internal server error", { cause: error });
  }
}
