import { filePathFromUrl } from "./files.js";

export function createRoutes({ reportDir, reportHandlers, staticHandlers }) {
  return [
    {
      methods: ["GET", "HEAD"],
      match: (url) => url.pathname === "/report",
      format: "text",
      handle: (req, res) => reportHandlers.serveReport(req, res),
    },
    {
      methods: ["GET", "HEAD"],
      match: (url) => url.pathname.startsWith("/screenshots/"),
      format: "text",
      handle: (req, res, url) => {
        const relativePath = url.pathname.slice("/screenshots".length) || "/";
        return reportHandlers.serveScreenshot(req, res, filePathFromUrl(reportDir, relativePath));
      },
    },
    {
      methods: ["PATCH"],
      match: (url) => url.pathname === "/tests/accept-passed",
      format: "json",
      handle: (req, res) => reportHandlers.acceptPassedTests(req, res),
    },
    {
      methods: ["PATCH"],
      match: (url) => url.pathname.match(/^\/tests\/(.+)$/),
      format: "json",
      handle: (req, res, url, match) => reportHandlers.patchTest(req, res, decodeURIComponent(match[1])),
    },
    {
      methods: ["GET", "HEAD"],
      match: () => true,
      format: "text",
      handle: (req, res, url) => staticHandlers.servePublicFile(req, res, url.pathname),
    },
  ];
}
