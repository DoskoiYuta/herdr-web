import type { DomainError } from "../domain/errors";

export type NotFoundError = { type: "not_found"; message: string };

export type UsecaseError = DomainError | NotFoundError;

export function notFound(message: string): NotFoundError {
  return { type: "not_found", message };
}
