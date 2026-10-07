import { createFileRoute } from "@tanstack/react-router";
import { OnboardingForm } from "@/components/onboarding/form";

export const Route = createFileRoute("/")({
  component: Home,
  head: () => ({
    meta: [
      { title: "PeakSwift — Let’s build your website" },
      { name: "description", content: "Share your business details so PeakSwift can design your website." },
    ],
  }),
});

function Home() {
  return <OnboardingForm />;
}
