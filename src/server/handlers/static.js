import { filePathFromUrl, serveFile } from "../files.js";

export function createStaticHandlers({ publicDir }) {
  async function servePublicFile(req, res, urlPath) {
    await serveFile(req, res, filePathFromUrl(publicDir, urlPath, "/index.html"));
  }

  return {
    servePublicFile,
  };
}
