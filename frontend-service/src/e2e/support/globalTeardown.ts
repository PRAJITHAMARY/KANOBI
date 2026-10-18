import { compose, STARTED_FLAG } from "./stack";

export default async function globalTeardown() {
  // E2E_KEEP_STACK=1 leaves the stack running for debugging or faster re-runs.
  if (process.env[STARTED_FLAG] !== "1" || process.env.E2E_KEEP_STACK === "1") {
    return;
  }

  console.log("Stopping the Kanobi stack…");
  compose("down", "--volumes", "--remove-orphans");
}
