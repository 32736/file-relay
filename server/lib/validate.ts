import { z } from 'zod'

export const MAX_FILENAME_LENGTH = 255

/** Strips any directory components so a filename can never carry a path. */
export function sanitizeBasename(name: string): string {
  const parts = name.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] ?? ''
}

/** Body schema for `POST /api/uploads`. */
export const createUploadSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(MAX_FILENAME_LENGTH)
    .transform(sanitizeBasename)
    .refine((name) => name.length > 0, { message: 'filename must not be empty' }),
  size: z.number().int().positive(),
  type: z.string().max(MAX_FILENAME_LENGTH).nullish(),
})
