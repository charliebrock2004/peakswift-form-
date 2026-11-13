import { createFileRoute } from "@tanstack/react-router";
import { ExampleRequestForm } from "@/components/onboarding/example-form";

export const Route = createFileRoute("/free-example")({
  component: FreeExample,
  head: () => ({
    meta: [
      { title: "Request your free website example — PeakSwift Studio" },
      {
        name: "description",
        content: "Request a free example of how your website homepage could look. No obligation — about two minutes.",
      },
      // A landing page for people we wrote to, not something to index.
      { name: "robots", content: "noindex" },
      // Keep the campaign reference out of other sites' logs.
      { name: "referrer", content: "strict-origin" },
    ],
  }),
});

function FreeExample() {
  return <ExampleRequestForm />;
}
