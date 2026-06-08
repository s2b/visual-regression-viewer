import fsp from "node:fs/promises";
import { HttpError } from "../errors.js";
import { serveFile } from "../files.js";
import { json } from "../responses.js";

const JSON_BODY_LIMIT = 1024 * 1024;

function testResponse(test) {
  return { ...test, id: String(test.identifier || "") };
}

async function readJsonBody(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > JSON_BODY_LIMIT) {
      throw new HttpError(413, "Request body too large");
    }
  }
  return body ? JSON.parse(body) : {};
}

async function readReport(reportPath) {
  const raw = await fsp.readFile(reportPath, "utf8");
  return JSON.parse(raw);
}

async function writeReport(reportPath, report) {
  await fsp.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

export function createReportHandlers({ reportPath }) {
  async function serveReport(req, res) {
    await serveFile(req, res, reportPath);
  }

  async function serveScreenshot(req, res, screenshotPath) {
    await serveFile(req, res, screenshotPath);
  }

  async function patchTest(req, res, identifier) {
    if (typeof identifier !== "string" || !identifier) {
      throw new HttpError(400, "Invalid test identifier");
    }

    const body = await readJsonBody(req);
    const updates = {};
    const patchFields = {
      accepted: {
        validate: (value) => typeof value === "boolean",
        message: "accepted must be a boolean",
      },
      status: {
        validate: (value) => typeof value === "string" && Boolean(value.trim()),
        message: "status must be a non-empty string",
        normalize: (value) => value.trim(),
      },
      updateScreenshotReference: {
        validate: (value) => typeof value === "boolean",
        message: "updateScreenshotReference must be a boolean",
      },
    };

    for (const [key, field] of Object.entries(patchFields)) {
      if (!(key in body)) {
        continue;
      }

      if (!field.validate(body[key])) {
        throw new HttpError(400, field.message);
      }

      updates[key] = field.normalize ? field.normalize(body[key]) : body[key];
    }

    if (!Object.keys(updates).length) {
      throw new HttpError(400, "No supported test updates provided");
    }

    const report = await readReport(reportPath);
    const index = Array.isArray(report.tests)
      ? report.tests.findIndex((test) => String(test.identifier || "") === identifier)
      : -1;
    if (index === -1) {
      throw new HttpError(404, "Test not found");
    }

    for (const [key, value] of Object.entries(updates)) {
      if (value === undefined) {
        delete report.tests[index][key];
      } else {
        report.tests[index][key] = value;
      }
    }

    await writeReport(reportPath, report);
    json(res, 200, { test: testResponse(report.tests[index]) });
  }

  async function acceptPassedTests(req, res) {
    const body = await readJsonBody(req);
    if (body.accepted !== undefined && body.accepted !== true) {
      throw new HttpError(400, "accepted must be true when provided");
    }

    const report = await readReport(reportPath);
    const updated = [];
    if (Array.isArray(report.tests)) {
      report.tests.forEach((test) => {
        if (test.status !== "passed" || test.accepted || test.updateScreenshotReference) {
          return;
        }
        test.accepted = true;
        updated.push(testResponse(test));
      });
    }

    if (updated.length) {
      await writeReport(reportPath, report);
    }

    json(res, 200, { updated: updated.length, tests: updated });
  }

  return {
    acceptPassedTests,
    patchTest,
    serveReport,
    serveScreenshot,
  };
}
