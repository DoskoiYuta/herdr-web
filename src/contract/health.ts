import * as v from "valibot";

export const HealthSchema = v.object({
  ok: v.literal(true),
  version: v.string(),
  herdr: v.object({ connected: v.boolean(), protocol: v.nullable(v.number()) }),
});
export type Health = v.InferOutput<typeof HealthSchema>;
