import type { Metadata } from "next";
import { Placeholder } from "@/components/app/Placeholder";

export const metadata: Metadata = { title: "Reports" };

export default function Page() {
  return <Placeholder title="Reports" icon="reports" />;
}
