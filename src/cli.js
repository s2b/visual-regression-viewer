import fs from "node:fs";
import path from "node:path";

const DEFAULT_REPORT_FILE = "visualregression.report.json";
const DEFAULT_REPORT_PATHS = [
  DEFAULT_REPORT_FILE,
  "visual-regression-results/visualregression.report.json",
];

const DEFAULT_CLI_ARGS = {
  help: false,
  host: "127.0.0.1",
  open: true,
  port: 3030,
  reportPath: null,
};

export class CliError extends Error {}

export function resolveDefaultReportPath(cwd) {
  const defaultReportPaths = DEFAULT_REPORT_PATHS.map((defaultPath) => path.resolve(cwd, defaultPath));
  return defaultReportPaths.find((defaultPath) => fs.existsSync(defaultPath))
    || path.resolve(cwd, DEFAULT_REPORT_FILE);
}

export function printHelp() {
  console.log(`Visual Regression Viewer

Usage:
  visual-regression-viewer [visualregression.report.json] [options]

Arguments:
  visualregression.report.json
                        Path to the report JSON file. If omitted, the viewer
                        checks these paths from the current directory:
                        ${DEFAULT_REPORT_PATHS.join("\n                        ")}

Options:
  -p, --port <number>   Port to listen on. Default: ${DEFAULT_CLI_ARGS.port}
  --host <host>         Host/IP to bind to. Default: ${DEFAULT_CLI_ARGS.host}
                        Use 0.0.0.0 to allow access from other computers.
  --no-open             Do not open the viewer in the default browser.
  -h, --help            Show this help message.
`);
}

export function parseArgs(argv) {
  if (argv.includes("--help") || argv.includes("-h")) {
    return { ...DEFAULT_CLI_ARGS, help: true };
  }

  const parsedArgs = [];
  const positionalArgs = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--port" || arg === "-p") {
      index += 1;
      if (index >= argv.length) {
        throw new CliError(`${arg} requires a port number.`);
      }
      parsedArgs.push({ port: Number(argv[index]) });
      continue;
    }

    if (arg.startsWith("--port=")) {
      parsedArgs.push({ port: Number(arg.slice("--port=".length)) });
      continue;
    }

    if (arg === "--host") {
      index += 1;
      if (index >= argv.length) {
        throw new CliError("--host requires a host or IP address.");
      }
      parsedArgs.push({ host: argv[index] });
      continue;
    }

    if (arg.startsWith("--host=")) {
      parsedArgs.push({ host: arg.slice("--host=".length) });
      continue;
    }

    if (arg === "--no-open") {
      parsedArgs.push({ open: false });
      continue;
    }

    if (arg.startsWith("-")) {
      throw new CliError(`Unknown option: ${arg}`);
    }

    positionalArgs.push(arg);
  }

  if (positionalArgs.length > 1) {
    throw new CliError(`Unexpected argument: ${positionalArgs[1]}`);
  }

  const args = Object.assign({}, DEFAULT_CLI_ARGS, ...parsedArgs, { reportPath: positionalArgs[0] || null });
  validateArgs(args);
  return args;
}

function validateArgs(args) {
  if (typeof args.host !== "string" || !args.host.trim()) {
    throw new CliError("Invalid host. Use an IP address or hostname.");
  }
  args.host = args.host.trim();

  if (!Number.isInteger(args.port) || args.port < 1 || args.port > 65535) {
    throw new CliError("Invalid port. Use a number between 1 and 65535.");
  }
}
