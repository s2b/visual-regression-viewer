import http from "node:http";
import { HttpError } from "./server/errors.js";
import { createReportHandlers } from "./server/handlers/report.js";
import { createStaticHandlers } from "./server/handlers/static.js";
import { error } from "./server/responses.js";
import { createRoutes } from "./server/routes.js";

export function createViewerServer({ publicDir, reportDir, reportPath }) {
  const staticHandlers = createStaticHandlers({ publicDir });
  const reportHandlers = createReportHandlers({ reportPath });
  const routes = createRoutes({ reportDir, reportHandlers, staticHandlers });

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    let routeMatch;

    try {
      for (const route of routes) {
        if (!route.methods.includes(req.method)) {
          continue;
        }

        const match = route.match(url);
        if (match) {
          routeMatch = { match, route };
          break;
        }
      }

      if (!routeMatch) {
        throw new HttpError(405, "Method not allowed");
      }

      await routeMatch.route.handle(req, res, url, routeMatch.match);
    } catch (caught) {
      error(res, caught, routeMatch?.route.format || "text");
    }
  });
}
