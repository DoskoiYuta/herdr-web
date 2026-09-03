import { ResultAsync } from "neverthrow";
import { RepoMoveTargetExistsError, type ReviewRepository } from "../ports";
import { domainError } from "../domain/errors";
import type { UsecaseError } from "./errors";

export type ReassignRepoDeps = { repository: ReviewRepository };
export type ReassignRepoInput = { from: string; to: string };
export type ReassignRepoResult = { repos: number; reviews: number };

/** 末尾の `/` を正規化する（root `"/"` はそのまま）。F8: from/to の境界揺れを吸収する */
function normalizeRepoPath(path: string): string {
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

/** `hw repo move`。前方一致の書き換えはアダプタの moveRepo が行う */
export function reassignRepoUsecase(deps: ReassignRepoDeps) {
  return function reassignRepoFn(
    input: ReassignRepoInput,
  ): ResultAsync<ReassignRepoResult, UsecaseError> {
    const from = normalizeRepoPath(input.from);
    const to = normalizeRepoPath(input.to);
    return ResultAsync.fromPromise(deps.repository.moveRepo(from, to), (e): UsecaseError => {
      if (e instanceof RepoMoveTargetExistsError) {
        return domainError("already_exists", `repo move target already exists: ${e.to}`);
      }
      throw e;
    });
  };
}
