import { z } from "zod";
import { ApiMethod } from "../../types";
import {
  ModelNameSchema,
  PropertyNameSchema,
  PropertyTypeSchema,
} from "../../utils/names";

export const CreateModelDtoSchema = z.object({
  name: ModelNameSchema,
  description: z.string().optional().default(""),
  properties: z
    .array(
      z.object({
        name: PropertyNameSchema,
        type: PropertyTypeSchema,
        required: z.boolean(),
      })
    )
    .refine(
      (props) => {
        // Case-insensitive, so near-duplicates such as "email" and "eMail" are rejected.
        const names = props.map((p) => p.name.toLowerCase());
        return new Set(names).size === names.length;
      },
      {
        message: "Duplicate property names are not allowed.",
        path: [],
      }
    ),
});

export const CreateModelResponseDtoSchema = z.object({
  id: z.string(),
  name: z.string().min(3),
  entityType: z.string(),
  description: z.string().optional().default(""),
  properties: z.array(
    z.object({
      name: z.string(),
      type: z.string(),
      required: z.boolean(),
    })
  ),
  apis: z.array(z.object({ method: z.string(), generate: z.boolean() })),
  relations: z
    .array(
      z.object({
        modelId: z.string(),
        relatedModel: z.string().min(3),
        relationship: z
          .enum(["one-to-one", "one-to-many", "many-to-one", "many-to-many"])
          .or(z.string()),
      })
    )
    .optional(),
});

export const CreateModelSchema = z.object({
  pk: z.string(),
  sk: z.string(),
  name: z.string().min(3),
  entityType: z.string(),
  description: z.string().optional().default(""),
  properties: z.array(
    z.object({
      name: z.string(),
      type: z.string(),
      required: z.boolean(),
    })
  ),
  apis: z.array(z.object({ method: z.string(), generate: z.boolean() })),
  relations: z
    .array(
      z.object({
        modelId: z.string(),
        mainModel: z.string(),
        relatedModel: z.string().min(3),
        relationship: z.string(),
        tableName: z.string(),
      })
    )
    .optional(),
});

export const UpdateModelApiSchema = z.object({
  apis: z.array(
    z.object({
      method: z.string().refine(
        (prop) => {
          return Object.values(ApiMethod).includes(prop as ApiMethod);
        },
        { message: `method must be one of ${Object.values(ApiMethod)}` }
      ),
      generate: z.boolean(),
    })
  ),
});

export const UpdateRelationsSchema = z.object({
  relations: z.array(
    z.object({
      modelId: z.string(),
      relationship: z.enum([
        "one-to-one",
        "one-to-many",
        "many-to-one",
        "many-to-many",
      ]),
    })
  ),
});

export type CreateModelResponseDto = z.infer<
  typeof CreateModelResponseDtoSchema
>;
export type CreateModelDto = z.infer<typeof CreateModelDtoSchema>;
export type CreateModel = z.infer<typeof CreateModelSchema>;

export const relationships = {
  "one-to-one": "one-to-one",
  "one-to-many": "many-to-one",
  "many-to-one": "one-to-many",
  "many-to-many": "many-to-many",
};
