import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";
import ProjectCard from "../components/ProjectCard";
import { useEffect, useState } from "react";
import Dialog from "../components/Dialog";
import LoadingScreen from "../components/LoadingScreen";
import ProjectNameField from "../components/ProjectNameField";
import FormBanner from "../components/FormBanner";
import { useProjectNameField } from "../components/useProjectNameField";

export default function Projects() {
  const { projects } = useLoaderData();
  const actionData = useActionData();
  const [open, setOpen] = useState(false);
  const [serverError, setServerError] = useState<string>();
  const name = useProjectNameField();
  const navigation = useNavigation();

  useEffect(() => {
    if (actionData?.success) setOpen(false);
    else if (actionData?.action === "post") setServerError(actionData.error);
  }, [actionData]);

  const openDialog = () => {
    name.reset();
    setServerError(undefined);
    setOpen(true);
  };

  return navigation.state == "loading" || navigation.state == "submitting" ? (
    <LoadingScreen />
  ) : (
    <div className="min-h-screen p-8 bg-gray-900 text-white">
      <div className="flex">
        <h1 className="text-2xl font-bold mb-6">Dashboard</h1>
        <button
          className="py-0 px-10 rounded ml-auto leading-none bg-blue-500 h-10"
          onClick={openDialog}
        >
          New
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {projects.data.map((project: any) => (
          <ProjectCard key={project.id} project={project} />
        ))}
      </div>

      <Dialog isOpen={open} onClose={() => setOpen(false)} title="New Project">
        <Form
          action="/project"
          method="post"
          noValidate
          onSubmit={(e) => {
            if (!name.validate()) e.preventDefault();
          }}
        >
          <FormBanner message={serverError} />
          <ProjectNameField
            value={name.value}
            error={name.error}
            onChange={name.onChange}
            onBlur={name.onBlur}
          />
          <input
            className="border p-2 rounded w-full mb-4 placeholder:text-white"
            placeholder="description"
            name="description"
          />
          <button
            type="submit"
            name="action"
            value="post"
            className="mt-4 bg-blue-500 text-white px-3 py-1 rounded"
          >
            Create
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="mt-4 ml-5 bg-red-500 text-white px-3 py-1 rounded"
          >
            Cancel
          </button>
        </Form>
      </Dialog>
    </div>
  );
}
