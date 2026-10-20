import { z } from "zod";
import { ProjectNameSchema } from "../../utils/names";

export const CreateProjectDtoSchema = z.object({
  name: ProjectNameSchema,
  description: z.string().optional(),
});

export const CreateProjectResponseDtoSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(3),
  description: z.string().optional(),
  stackName: z.string().optional(),
});

export const CreateProjectSchemaSchema = z.object({
  pk: z.string(),
  sk: z.string(),
  name: z.string().min(3),
  stackName: z.string().optional(),
  description: z.string().optional(),
  entityType: z.string(),
  /** The Cognito `sub` of the user who created the project. */
  ownerId: z.string().optional(),
});

export type CreateProjectResponseDto = z.infer<
  typeof CreateProjectResponseDtoSchema
>;
export type CreateProjectDto = z.infer<typeof CreateProjectDtoSchema>;
export type ProjectModel = z.infer<typeof CreateProjectSchemaSchema>;
