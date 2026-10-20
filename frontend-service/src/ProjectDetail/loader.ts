import { redirect } from "react-router";
import { apiFetch } from "../api";

export const projectDetailLoader = async ({ params }: { params: any }) => {
  try {
    const { id } = params;
    const projectResponse = await apiFetch(
      `/project/${id}`
    );

    const project = (await projectResponse.json()).data;
    if (!project) {
      alert("Error fetching project");
      return redirect("/project");
    }

    // const projectCost = await apiFetch(
    //   `/project/cost/${id}`
    // );
    // const bill = (await projectCost.json()).data;

    const deploymentResponse = await apiFetch(
      `/deployment/${id}`
    );
    const deployment = (await deploymentResponse.json()).data;

    return { project, deployment };
  } catch (error: any) {
    alert(error.message);
  }
};
