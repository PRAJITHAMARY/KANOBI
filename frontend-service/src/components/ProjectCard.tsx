import { Form, Link, useActionData, useSubmit } from "react-router";
import { X, ClipboardPen } from "lucide-react";
import { useEffect, useState } from "react";
import Dialog from "./Dialog";
import FormBanner from "./FormBanner";
import ProjectNameField from "./ProjectNameField";
import { useProjectNameField } from "./useProjectNameField";

export default function ProjectCard({ project }: { project: any }) {
  const [open, setOpen] = useState(false);
  const [openEdit, setOpenEdit] = useState(false);
  const name = useProjectNameField(project.name);
  const [description, setDescription] = useState(project.description);
  const [serverError, setServerError] = useState<string>();
  const submit = useSubmit();
  const actionData = useActionData();

  useEffect(() => {
    if (actionData?.success) setOpenEdit(false);
    else if (actionData?.action === "put" && actionData.id === project.id)
      setServerError(actionData.error);
  }, [actionData, project.id]);

  const openEditDialog = () => {
    name.reset();
    setServerError(undefined);
    setOpenEdit(true);
  };

  return (
    <div
      data-testid="project-card"
      className="p-4 pt-0.5 pr-0.5 border shadow transition bg-gray-600"
    >
      <div className="ml-auto flex">
        <ClipboardPen
          role="button"
          aria-label="Edit project"
          className="text-blue-500 ml-auto cursor-pointer"
          onClick={openEditDialog}
        />
        <X
          role="button"
          aria-label="Delete project"
          className="text-red-600 ml-2 cursor-pointer"
          onClick={() => setOpen(true)}
        />
      </div>
      <Link to={`/project/${project.id}`}>
        <div className="cursor-pointer">
          <h2 className="text-lg font-bold">{project.name}</h2>
          <p>{project.description}</p>
          <p className="text-sm">{project.stackName}</p>
        </div>
      </Link>

      <Dialog
        isOpen={open}
        onClose={() => setOpen(false)}
        title={`Delete ${project.name}`}
      >
        <p>Are you sure you want to delete this project?</p>
        <p>Every infrastructure, including databases will be erased!</p>
        <button
          onClick={() => {
            submit(
              {
                projectId: project.id,
                action: "delete",
              },
              { action: "/project", method: "post" }
            );
            setOpen(false);
          }}
          className="mt-4 bg-blue-500 text-white px-3 py-1 rounded"
        >
          Proceed
        </button>
        <button
          onClick={() => setOpen(false)}
          className="mt-4 ml-5 bg-red-500 text-white px-3 py-1 rounded"
        >
          Close
        </button>
      </Dialog>

      <Dialog
        isOpen={openEdit}
        onClose={() => setOpenEdit(false)}
        title="Edit Project"
      >
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
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            name="description"
          />

          <input hidden name="id" value={project.id} />
          <button
            type="submit"
            name="action"
            value="put"
            className="mt-4 bg-blue-500 text-white px-3 py-1 rounded"
          >
            Update
          </button>
          <button
            type="button"
            onClick={() => setOpenEdit(false)}
            className="mt-4 ml-5 bg-red-500 text-white px-3 py-1 rounded"
          >
            Cancel
          </button>
        </Form>
      </Dialog>
    </div>
  );
}
