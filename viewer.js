#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openBrowser } from "./src/browser.js";
import { CliError, parseArgs, printHelp, resolveDefaultReportPath } from "./src/cli.js";
import { createViewerServer } from "./src/server.js";

let cliArgs;
try {
  cliArgs = parseArgs(process.argv.slice(2));
} catch (error) {
  if (error instanceof CliError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}

if (cliArgs.help) {
  printHelp();
  process.exit(0);
}

const root = path.dirname(fileURLToPath(import.meta.url));
const reportPath = cliArgs.reportPath
  ? path.resolve(process.cwd(), cliArgs.reportPath)
  : resolveDefaultReportPath(process.cwd());
let reportStat;
try {
  reportStat = fs.statSync(reportPath);
} catch (error) {
  if (error.code === "ENOENT") {
    console.error(`Report file not found: ${reportPath}`);
  } else {
    console.error(`Cannot access report file: ${reportPath}`);
  }
  process.exit(1);
}
if (!reportStat.isFile()) {
  console.error(`Report path is not a file: ${reportPath}`);
  process.exit(1);
}
const reportDir = path.dirname(reportPath);
const publicDir = path.join(root, "public");

const server = createViewerServer({ publicDir, reportDir, reportPath });

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${cliArgs.port} is already in use on ${cliArgs.host}. Use --port to choose another port.`);
    process.exit(1);
  }

  if (error.code === "EACCES" || error.code === "EPERM") {
    console.error(`Cannot listen on ${cliArgs.host}:${cliArgs.port}. Use a different --host or --port.`);
    process.exit(1);
  }

  console.error(error);
  process.exit(1);
});

server.listen(cliArgs.port, cliArgs.host, () => {
  const url = `http://${cliArgs.host}:${cliArgs.port}`;
  console.log(`Visual regression viewer running at ${url}`);
  console.log(`Serving report from ${reportPath}`);
  if (cliArgs.open) {
    openBrowser(url);
  }
});
