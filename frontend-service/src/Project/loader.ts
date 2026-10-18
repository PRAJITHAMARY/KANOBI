import { API_URL } from "../config";

export const projectsLoader = async () => {
  try {
    const response = await fetch(
      `${API_URL}/project`
    );

    const projects = await response.json();

    return { projects };
  } catch (error: any) {
    alert(error.message);
  }
};
