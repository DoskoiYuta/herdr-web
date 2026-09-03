import { ResultAsync } from "neverthrow";
import type { ReviewRepository } from "../ports";

export type ReassignRepoDeps = { repository: ReviewRepository };
export type ReassignRepoInput = { from: string; to: string };
export type ReassignRepoResult = { repos: number; reviews: number };

/** `hw repo move`。前方一致の書き換えはアダプタの moveRepo が行う */
export function reassignRepoUsecase(deps: ReassignRepoDeps) {
  return function reassignRepoFn(input: ReassignRepoInput): ResultAsync<ReassignRepoResult, never> {
    return ResultAsync.fromSafePromise(deps.repository.moveRepo(input.from, input.to));
  };
}
