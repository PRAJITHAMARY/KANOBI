import { API_URL } from "../config";

export const projectAction = async ({ request }: { request: Request }) => {
  const formData = await request.formData();
  const action = formData.get("action");
  try {
    if (action == "post") {
      const name = formData.get("name");
      const description = formData.get("description");

      const response = await fetch(
        `${API_URL}/project`,
        {
          method: "POST",
          body: JSON.stringify({ name, description }),
        }
      );

      const resData = await response.json();

      return { success: true, data: resData };
    }

    if (action == "delete") {
      const id = formData.get("projectId");
      const response = await fetch(
        `${API_URL}/project/${id}`,
        {
          method: "DELETE",
        }
      );

      return { success: true, data: response.status };
    }

    if (action == "put") {
      const id = formData.get("id");
      const name = formData.get("name");
      const description = formData.get("description");
      
      const response = await fetch(
        `${API_URL}/project/${id}`,
        {
          method: "PUT",
          body: JSON.stringify({ name, description }),
        }
      );

      return { success: true, data: response.status };
    }
  } catch (error: any) {
    alert(error.message);
  }
};
