import { createFileRoute } from "@tanstack/react-router";
import { StudioApp } from "@/components/studio/studio";

export const Route = createFileRoute("/studio")({
  component: StudioPage,
  head: () => ({
    meta: [{ title: "Studio — PeakSwift" }],
  }),
});

function StudioPage() {
  return <StudioApp />;
}
