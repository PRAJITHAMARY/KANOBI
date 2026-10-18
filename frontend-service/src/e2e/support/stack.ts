import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

// The repo-root compose file; e2e runs from frontend-service.
const COMPOSE_FILE = resolve(import.meta.dirname, "..", "..", "..", "..", "docker-compose.yml");

// Set by globalSetup when it started the stack, so globalTeardown only stops
// what it started (a stack you already had running is left alone).
export const STARTED_FLAG = "KANOBI_E2E_STARTED_STACK";

export const compose = (...args: string[]) =>
  execFileSync("docker", ["compose", "-f", COMPOSE_FILE, ...args], {
    stdio: "inherit",
  });

export const isUp = async (url: string) => {
  try {
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
};
