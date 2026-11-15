import type { Metadata } from "next";
import MissionControl from "@/components/ui/MissionControl";

export const metadata: Metadata = {
  title: "mission control · hypothetical",
  description: "watch the governors evolve live: the world being simulated now, the worlds lost tonight, and the lessons they leave behind.",
};

export default function MissionPage() {
  return <MissionControl />;
}
