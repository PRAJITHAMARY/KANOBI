import { redirect } from "react-router";
import { API_URL } from "../config";

export const projectDetailLoader = async ({ params }: { params: any }) => {
  try {
    const { id } = params;
    const projectResponse = await fetch(
      `${API_URL}/project/${id}`
    );

    const project = (await projectResponse.json()).data;
    if (!project) {
      alert("Error fetching project");
      return redirect("/project");
    }

    // const projectCost = await fetch(
    //   `${API_URL}/project/cost/${id}`
    // );
    // const bill = (await projectCost.json()).data;

    const deploymentResponse = await fetch(
      `${API_URL}/deployment/${id}`
    );
    const deployment = (await deploymentResponse.json()).data;

    return { project, deployment };
  } catch (error: any) {
    alert(error.message);
  }
};
