// TanStack Query wrapper around herdrApi.panePreview(), for the send-target
// picker cards (ToolPane.tsx). `enabled` lets the dialog fetch only while
// it's open, and a failed preview just leaves `data` undefined — the card
// still renders (and still sends) off the PaneRow fallback.
import { useQuery } from "@tanstack/react-query";
import { herdrApi } from "@/lib/api";

export function usePanePreview(pane: string, enabled: boolean) {
  return useQuery({
    queryKey: ["pane-preview", pane],
    queryFn: () => herdrApi.panePreview(pane),
    enabled,
    staleTime: 0,
    retry: false,
  });
}
