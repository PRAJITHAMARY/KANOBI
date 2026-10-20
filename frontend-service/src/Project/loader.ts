import { apiFetch } from "../api";

export const projectsLoader = async () => {
  try {
    const response = await apiFetch(
      `/project`
    );

    const projects = await response.json();

    return { projects };
  } catch (error: any) {
    alert(error.message);
  }
};
