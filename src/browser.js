import { spawn } from "node:child_process";

export function openBrowser(url) {
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
