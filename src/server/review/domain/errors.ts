export type DomainErrorType =
  | "not_repliable"
  | "already_resolved"
  | "not_outdatable"
  | "already_committed"
  | "not_commit_bound";

export type DomainError = { type: DomainErrorType; message: string };

export function domainError(type: DomainErrorType, message: string): DomainError {
  return { type, message };
}
