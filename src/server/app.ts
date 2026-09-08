import { Hono } from "hono";
import type { ClientConfig } from "../contract/config";
import type { Health } from "../contract/health";
import type { FetchRunner } from "./git/fetch";
import { askRoutes, type AskRoutesDeps } from "./routes/ask";
import { decisionRoutes, type DecisionRoutesDeps } from "./routes/decision";
import { dockerRoutes, type DockerRoutesDeps } from "./routes/docker";
import { fsRoutes } from "./routes/fs";
import { gitRoutes } from "./routes/git";
import { herdrRoutes, type HerdrRoutesDeps } from "./routes/herdr";
import { hwRoutes, type HwRoutesDeps } from "./routes/hw";
import { inboxRoutes, type InboxRoutesDeps } from "./inbox/routes";
import { notesRoutes, type NotesRoutesDeps } from "./routes/notes";
import { procRoutes, type ProcRoutesDeps } from "./routes/proc";
import {
  repoRoutes,
  reviewRoutes,
  type RepoRoutesDeps,
  type ReviewRoutesDeps,
} from "./routes/review";

export type AppDeps = {
  version: string;
  herdrStatus: () => { connected: boolean; protocol: number | null };
  git?: { allowedRoots?: string[]; fetchRunner?: FetchRunner };
  clientConfig: () => ClientConfig;
  review: ReviewRoutesDeps;
  repo: RepoRoutesDeps;
  hw: HwRoutesDeps;
  herdr: HerdrRoutesDeps;
  ask: AskRoutesDeps;
  decision: DecisionRoutesDeps;
  notes: NotesRoutesDeps;
  docker?: DockerRoutesDeps;
  proc?: ProcRoutesDeps;
  inbox: InboxRoutesDeps;
};

export function createApp(deps: AppDeps) {
  const app = new Hono()
    .get("/api/health", (c) => {
      const body: Health = { ok: true, version: deps.version, herdr: deps.herdrStatus() };
      return c.json(body);
    })
    .get("/api/config", (c) => c.json(deps.clientConfig()))
    .route("/api/git", gitRoutes(deps.git))
    .route("/api/fs", fsRoutes(deps.git))
    .route("/api/review", reviewRoutes(deps.review))
    .route("/api/repo", repoRoutes(deps.repo))
    .route("/api/hw", hwRoutes(deps.hw))
    .route("/api/herdr", herdrRoutes(deps.herdr))
    .route("/api/ask", askRoutes(deps.ask))
    .route("/api/decision", decisionRoutes(deps.decision))
    .route("/api/notes", notesRoutes(deps.notes))
    .route("/api/docker", dockerRoutes(deps.docker))
    .route("/api/proc", procRoutes(deps.proc))
    .route("/api/inbox", inboxRoutes(deps.inbox));
  return app;
}

export type AppType = ReturnType<typeof createApp>;
