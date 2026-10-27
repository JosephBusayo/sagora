import type { Metadata } from "next";
import { Placeholder } from "@/components/app/Placeholder";

export const metadata: Metadata = { title: "Jobs" };

export default function Page() {
  return <Placeholder title="Jobs" icon="jobs" />;
}
