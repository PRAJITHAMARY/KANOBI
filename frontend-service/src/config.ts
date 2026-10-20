// Base URL of the Kanobi API. Set per mode in .env.development / .env.production /
// .env.test, or override with VITE_API_URL (the Docker setup does this).
export const API_URL = import.meta.env.VITE_API_URL;

// Cognito's JSON API (https://cognito-idp.<region>.amazonaws.com/, or
// cognito-local in Docker) and the app client the UI signs in with.
export const COGNITO_ENDPOINT = import.meta.env.VITE_COGNITO_ENDPOINT;
export const COGNITO_CLIENT_ID = import.meta.env.VITE_COGNITO_CLIENT_ID;
