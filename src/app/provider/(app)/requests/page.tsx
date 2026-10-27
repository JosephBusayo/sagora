import type { Metadata } from "next";
import { Placeholder } from "@/components/app/Placeholder";

export const metadata: Metadata = { title: "Requests" };

export default function Page() {
  return <Placeholder title="Requests" icon="requests" />;
}
