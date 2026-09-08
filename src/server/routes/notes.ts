import { vValidator } from "@hono/valibot-validator";
import { Hono } from "hono";
import {
  CreateNoteRequestSchema,
  ListNoteQuerySchema,
  UpdateNoteRequestSchema,
} from "../../contract/notes";
import type { NotesService } from "../notes/service";

export type NotesRoutesDeps = {
  service: NotesService;
};

export function notesRoutes(deps: NotesRoutesDeps) {
  const app = new Hono()
    .get("/", vValidator("query", ListNoteQuerySchema), async (c) => {
      const { repo } = c.req.valid("query");
      return c.json(await deps.service.listNotes(repo));
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
