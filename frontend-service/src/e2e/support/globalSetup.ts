import { API_URL, BASE_URL } from "../../../playwright.config";
import { compose, isUp, STARTED_FLAG } from "./stack";

export default async function globalSetup() {
  if ((await isUp(BASE_URL)) && (await isUp(`${API_URL}/health`))) {
    console.log(`Reusing the running Kanobi stack at ${BASE_URL}`);
    return;
  }

  console.log("Starting the Kanobi stack with docker compose…");
  // --wait blocks until every service's healthcheck passes (LocalStack is only
  // healthy once seed.sh has created the table and bucket).
  compose("up", "--build", "--detach", "--wait", "--wait-timeout", "600");
  process.env[STARTED_FLAG] = "1";
}
