import { vValidator } from "@hono/valibot-validator";
import { Hono } from "hono";
import {
  CreateNoteRequestSchema,
  ListNoteQuerySchema,
  UpdateNoteRequestSchema,
  type Note,
} from "../../contract/notes";
import type { NotesRepository } from "../notes/ports";
import type { NotesService } from "../notes/service";
import { resolveShortId } from "./short-id";

export type NotesRoutesDeps = {
  service: NotesService;
  repository: NotesRepository;
};

type FindByIdResult = { kind: "found"; note: Note } | { kind: "not_found" } | { kind: "ambiguous" };

async function findNoteByIdOrSuffix(
  repository: NotesRepository,
  id: string,
): Promise<FindByIdResult> {
  const result = await resolveShortId(id, {
    getFull: (fullId) => repository.get(fullId),
    listCandidates: () => repository.listAll(),
    idOf: (n) => n.id,
  });
  if (result.kind === "found") return { kind: "found", note: result.value };
  return result;
}

export function notesRoutes(deps: NotesRoutesDeps) {
  const app = new Hono()
    .get("/", vValidator("query", ListNoteQuerySchema), async (c) => {
      const { repo } = c.req.valid("query");
      return c.json(await deps.service.listNotes(repo));
    })
    .get("/:id", async (c) => {
      const found = await findNoteByIdOrSuffix(deps.repository, c.req.param("id"));
      if (found.kind === "ambiguous") {
        return c.json({ error: "ambiguous id", type: "ambiguous" }, 409);
      }
      if (found.kind === "not_found") {
        return c.json({ error: "note not found" }, 404);
      }
      return c.json(found.note);
    })
    .post("/", vValidator("json", CreateNoteRequestSchema), async (c) => {
      const body = c.req.valid("json");
      const note = await deps.service.createNote(body.repoKey, body.title);
      return c.json(note, 201);
    })
    .patch("/:id", vValidator("json", UpdateNoteRequestSchema), async (c) => {
      const result = await deps.service.updateNote(c.req.param("id"), c.req.valid("json"));
      return result.match(
        (note) => c.json(note),
        (error) => c.json({ error: error.message, type: error.type }, 404),
      );
    })
    .delete("/:id", async (c) => {
      const result = await deps.service.deleteNote(c.req.param("id"));
      return result.match(
        () => c.body(null, 204),
        (error) => c.json({ error: error.message, type: error.type }, 404),
      );
    });

  return app;
}

export type NotesRoutesType = ReturnType<typeof notesRoutes>;
