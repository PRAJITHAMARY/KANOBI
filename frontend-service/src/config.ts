// Base URL of the Kanobi API. Set per mode in .env.development / .env.production /
// .env.test, or override with VITE_API_URL (the Docker setup does this).
export const API_URL = import.meta.env.VITE_API_URL;
