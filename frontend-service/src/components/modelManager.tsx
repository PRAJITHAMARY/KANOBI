import { useState } from "react";
import { API_URL } from "../config";

type Project = {
  id: string;
  name: string;
  description: string;
  models: Model[];
};

type Api = {
  method: string;
  generate: boolean;
};

type Property = {
  name: string;
  type: "string" | "number" | "boolean";
  required: boolean;
};

type Relationship = {
  modelId: string;
  relatedModel: string;
  relationship: string;
};

type Model = {
  id: string;
  name: string;
  entityType: string;
  description: string;
  apis: Api[];
  properties: Property[];
  changed?: boolean;
  relations: Relationship[];
};

export default function ModelManager({
  project,
  isDeploying,
}: {
  project: Project;
  isDeploying: boolean;
}) {
  const [models, setModels] = useState<Model[]>(project.models);
  const [newModelName, setNewModelName] = useState("");
  const [newModelDesc, setNewModelDesc] = useState("");
  const [relToDelete, setRelToDelete] = useState<Relationship[]>([]);

  const addModel = async () => {
    // Unreachable from the UI (the button is disabled); kept as a guard.
    /* v8 ignore if -- @preserve */
    if (!newModelName.trim()) return;

    const newModel = {
      name: newModelName.trim(),
      description: newModelDesc.trim(),
      properties: [],
    };

    const res = await fetch(
      `${API_URL}/model/${project.id}`,
      {
        method: "POST",
        body: JSON.stringify(newModel),
      }
    );

    if (res.ok) {
      const responseData = await res.json();
      console.log(responseData);
      setModels((prev) => [...prev, responseData.data]);
      setNewModelName("");
      setNewModelDesc("");
    }
  };

  // Edit model fields
  const editModel = (
    id: string,
    field: keyof Pick<Model, "name" | "description">,
    value: string
  ) => {
    setModels((prev) =>
      prev.map((m) =>
        m.id === id ? { ...m, [field]: value, changed: true } : m
      )
    );
  };

  // Delete model
  const deleteModel = async (id: string) => {
    const res = await fetch(
      `${API_URL}/model/${project.id}/${id}`,
      {
        method: "DELETE",
      }
    );

    if (res.ok) {
      setModels((prev) => prev.filter((m) => m.id !== id));
    }
  };

  // Toggle API generate
  const toggleApiGenerate = (modelId: string, method: string) => {
    setModels((prev) =>
      prev.map((m) =>
        m.id === modelId
          ? {
              ...m,
              apis: m.apis.map((api) =>
                api.method === method
                  ? { ...api, generate: !api.generate }
                  : api
              ),
              changed: true,
            }
          : m
      )
    );
  };

  // Add property
  const addProperty = (modelId: string) => {
    setModels((prev) =>
      prev.map((m) =>
        m.id === modelId
          ? {
              ...m,
              properties: [
                ...m.properties,
                { name: "", type: "string", required: false },
              ],
              changed: true,
            }
          : m
      )
    );
  };

  // Edit property field
  const editProperty = (
    modelId: string,
    index: number,
    field: keyof Property,
    value: string | boolean
  ) => {
    setModels((prev) =>
      prev.map((m) => {
        if (m.id === modelId) {
          const newProps = m.properties.map((p, i) =>
            i === index ? { ...p, [field]: value } : p
          );
          return { ...m, properties: newProps, changed: true };
        }
        return m;
      })
    );
  };

  // Delete property
  const deleteProperty = async (modelId: string, index: number) => {
    setModels((prev) =>
      prev.map((m) =>
        m.id === modelId
          ? {
              ...m,
              changed: true,
              properties: m.properties.filter((_, i) => i !== index),
            }
          : m
      )
    );
  };

  // Add Relationship
  const addRelationship = (modelId: string) => {
    setModels((prev) =>
      prev.map((m) =>
        m.id === modelId
          ? {
              ...m,
              relations: [
                ...(m.relations || []),
                { modelId: "", relatedModel: "", relationship: "" },
              ],
              changed: true,
            }
          : m
      )
    );
  };

  // Edit Relationship field
  const editRelationship = (
    modelId: string,
    index: number,
    field: keyof Relationship,
    value: string
  ) => {
    setModels((prev) =>
      prev.map((m) => {
        if (m.id === modelId) {
          const newProps = m.relations.map((r, i) => {
            if (i === index) {
              // Never true today: the selects only edit "modelId" and "relationship" (see TODO.md).
              /* v8 ignore next 8 -- @preserve */
              if (
                field == "relatedModel" &&
                r.modelId &&
                r.relatedModel &&
                r.relationship
              ) {
                setRelToDelete([...relToDelete, r]);
              }

              return { ...r, [field]: value };
            }
            return r;
          });
          return { ...m, relations: newProps, changed: true };
        }
        return m;
      })
    );
  };

  // Delete property
  const deleteRelationship = async (modelId: string, index: number) => {
    const model = models.find((x) => x.id == modelId);
    // Unreachable from the UI: ids and indexes come from the rendered list.
    /* v8 ignore if -- @preserve */
    if (!model) return;

    const relation = model.relations[index];
    /* v8 ignore if -- @preserve */
    if (!relation) return;

    const res = await fetch(
      `${API_URL}/model-relations/${project.id}/${modelId}`,
      {
        method: "PUT",
        body: JSON.stringify({
          relations: [
            {
              modelId: relation.modelId,
              modelName: relation.relatedModel,
              relationship: relation.relationship,
            },
          ],
        }),
      }
    );

    if (res.ok) {
      window.location.reload();
    }
  };

  const pushModelUpdate = async (modelId: string) => {
    const model = models.find((x) => x.id === modelId);
    // Unreachable from the UI: the id comes from the rendered list.
    /* v8 ignore if -- @preserve */
    if (!model) return;

    // relToDelete is never populated today (see editRelationship / TODO.md).
    /* v8 ignore if -- @preserve */
    if (relToDelete.length > 0) {
      await fetch(
        `${API_URL}/model-relations/${project.id}/${modelId}`,
        {
          method: "PUT",
          body: JSON.stringify({
            relations: relToDelete.map((relation) => {
              return {
                modelId: relation.modelId,
                relationship: relation.relationship,
              };
            }),
          }),
        }
      );
    }

    const res = await fetch(
      `${API_URL}/model/${project.id}/${modelId}`,
      {
        method: "PUT",
        body: JSON.stringify({
          name: model.name,
          description: model.description,
          properties: [...model.properties],
        }),
      }
    );

    const res1 = await fetch(
      `${API_URL}/model-api/${project.id}/${modelId}`,
      {
        method: "PUT",
        body: JSON.stringify({
          apis: model.apis,
        }),
      }
    );

    await fetch(
      `${API_URL}/model-relations/${project.id}/${modelId}`,
      {
        method: "POST",
        body: JSON.stringify({
          relations: model.relations.map((relation) => {
            return {
              modelId: relation.modelId,
              relationship: relation.relationship,
            };
          }),
        }),
      }
    );

    if (res.ok && res1.ok) {
      setModels((prev) =>
        prev.map((m) =>
          m.id === modelId
            ? {
                ...m,
                changed: false,
              }
            : m
        )
      );

      window.location.reload();
    }
  };

  const redeployChanges = async () => {
    const res = await fetch(
      `${API_URL}/deployment`,
      {
        method: "PUT",
        body: JSON.stringify({
          projectId: project.id,
        }),
      }
    );

    if (res.ok) {
      alert("Redeployment in progress... Refresh page to see logs");
      window.location.reload();
    }
  };

  console.log(relToDelete);

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-8 font-sans">
      <section className="border p-4 rounded shadow space-y-4 bg-gray-900">
        <h2 className="text-xl font-semibold">Add New Model</h2>
        <input
          type="text"
          placeholder="Model name"
          value={newModelName}
          onChange={(e) => setNewModelName(e.target.value)}
          className="border rounded px-3 py-2 w-full"
        />
        <textarea
          placeholder="Description (optional)"
          value={newModelDesc}
          onChange={(e) => setNewModelDesc(e.target.value)}
          className="border rounded px-3 py-2 w-full"
          rows={2}
        />
        <button
          onClick={addModel}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
          disabled={!newModelName.trim()}
        >
          Add Model
        </button>
      </section>

      <section className="space-y-6">
        {models.map((model) => (
          <div
            key={model.id}
            className="border rounded p-4 shadow bg-gray-900 space-y-4"
          >
            {/* Model Header: name + description + delete */}
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <div className="flex flex-col md:flex-row md:gap-4 md:items-center flex-1">
                <input
                  type="text"
                  value={model.name}
                  onChange={(e) => editModel(model.id, "name", e.target.value)}
                  className="font-semibold text-lg border-b focus:outline-none flex-1"
                  placeholder="Model Name"
                />
                <input
                  type="text"
                  value={model.description}
                  onChange={(e) =>
                    editModel(model.id, "description", e.target.value)
                  }
                  placeholder="Description"
                  className="border rounded px-2 py-1 flex-1 max-w-md"
                />
              </div>
              <button
                onClick={() => deleteModel(model.id)}
                className="text-red-600 hover:underline self-start md:self-auto"
                title="Delete model"
              >
                Delete Model
              </button>
            </div>

            {/* APIs Section */}
            <div>
              <h3 className="font-semibold mb-2">APIs</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {model.apis.map((api) => (
                  <label
                    key={api.method}
                    className="flex items-center gap-2 cursor-pointer select-none"
                  >
                    <input
                      type="checkbox"
                      checked={api.generate}
                      onChange={() => toggleApiGenerate(model.id, api.method)}
                      className="cursor-pointer"
                    />
                    <span className="capitalize">{api.method}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Properties Section */}
            <div>
              <h3 className="font-semibold mb-2">Properties</h3>
              <table className="w-full text-left border-collapse border border-gray-300">
                <thead>
                  <tr className="bg-gray-900">
                    <th className="border border-gray-300 px-2 py-1">Name</th>
                    <th className="border border-gray-300 px-2 py-1">Type</th>
                    <th className="border border-gray-300 px-2 py-1">
                      Required
                    </th>
                    <th className="border border-gray-300 px-2 py-1">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {model.properties.map((prop, idx) => (
                    <tr key={idx}>
                      <td className="border border-gray-300 px-2 py-1">
                        <input
                          type="text"
                          value={prop.name}
                          onChange={(e) =>
                            editProperty(model.id, idx, "name", e.target.value)
                          }
                          className="w-full border rounded px-1 py-0.5"
                          placeholder="Property name"
                        />
                      </td>
                      <td className="border border-gray-300 px-2 py-1">
                        <select
                          value={prop.type}
                          onChange={(e) =>
                            editProperty(
                              model.id,
                              idx,
                              "type",
                              e.target.value as Property["type"]
                            )
                          }
                          className="w-full border rounded px-1 py-0.5"
                        >
                          <option value="string">string</option>
                          <option value="number">number</option>
                          <option value="boolean">boolean</option>
                        </select>
                      </td>
                      <td className="border border-gray-300 px-2 py-1 text-center">
                        <input
                          type="checkbox"
                          checked={prop.required}
                          onChange={(e) =>
                            editProperty(
                              model.id,
                              idx,
                              "required",
                              e.target.checked
                            )
                          }
                        />
                      </td>
                      <td className="border border-gray-300 px-2 py-1 text-center">
                        <button
                          onClick={() => deleteProperty(model.id, idx)}
                          className="text-red-600 hover:underline"
                          title="Delete property"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                  {model.properties.length === 0 && (
                    <tr>
                      <td
                        colSpan={4}
                        className="text-center text-gray-500 py-2"
                      >
                        No properties defined.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              <div className="flex justify-between">
                <button
                  onClick={() => addProperty(model.id)}
                  className="mt-2 bg-green-600 text-white px-3 py-1 rounded hover:bg-green-700 flex-start"
                >
                  + Add Property
                </button>
              </div>
            </div>

            {/* Relationship Section */}
            <div>
              <h3 className="font-semibold mb-2">Relations</h3>
              <table className="w-full text-left border-collapse border border-gray-300">
                <thead>
                  <tr className="bg-gray-900">
                    <th className="border border-gray-300 px-2 py-1">Model</th>
                    <th className="border border-gray-300 px-2 py-1">Type</th>
                    <th className="border border-gray-300 px-2 py-1">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {model.relations?.map((prop, idx) => (
                    <tr key={idx}>
                      <td className="border border-gray-300 px-2 py-1">
                        <select
                          value={prop.modelId}
                          onChange={(e) =>
                            editRelationship(
                              model.id,
                              idx,
                              "modelId",
                              e.target.value as Relationship["modelId"]
                            )
                          }
                          className="w-full border rounded px-1 py-0.5"
                        >
                          <option value={""}>{""}</option>
                          {project.models
                            .filter((x) => x.id != model.id)
                            .map((x) => (
                              <option key={x.id} id={x.id} value={x.id}>
                                {x.name}
                              </option>
                            ))}
                        </select>
                      </td>
                      <td className="border border-gray-300 px-2 py-1">
                        <select
                          value={prop.relationship}
                          onChange={(e) =>
                            editRelationship(
                              model.id,
                              idx,
                              "relationship",
                              e.target.value as Relationship["relationship"]
                            )
                          }
                          className="w-full border rounded px-1 py-0.5"
                        >
                          <option value=""></option>
                          <option value="one-to-one">one to one</option>
                          <option value="one-to-many">one to many</option>
                          <option value="many-to-one">many to one</option>
                          <option value="many-to-many">many to many</option>
                        </select>
                      </td>

                      <td className="border border-gray-300 px-2 py-1 text-center">
                        <button
                          onClick={() => deleteRelationship(model.id, idx)}
                          className="text-red-600 hover:underline"
                          title="Delete property"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                  {model.relations?.length === 0 && (
                    <tr>
                      <td
                        colSpan={4}
                        className="text-center text-gray-500 py-2"
                      >
                        No relationship defined
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              <div className="flex justify-between">
                <button
                  onClick={() => addRelationship(model.id)}
                  className="mt-2 bg-green-600 text-white px-3 py-1 rounded hover:bg-green-700 flex-start"
                >
                  + Add Relationship
                </button>

                <button
                  onClick={() => pushModelUpdate(model.id)}
                  disabled={!model.changed}
                  className="mt-2 bg-blue-600 text-white px-3 py-1 rounded hover:bg-green-700 flex-end"
                >
                  Push Update
                </button>
              </div>
            </div>
          </div>
        ))}
      </section>
      <section className="flex justify-center gap-38">
        <button
          onClick={() => redeployChanges()}
          disabled={isDeploying}
          className="mt-2 bg-blue-600 text-white px-3 py-1 rounded hover:bg-green-700 flex-end"
        >
          Deploy changes
        </button>
      </section>
    </div>
  );
}
