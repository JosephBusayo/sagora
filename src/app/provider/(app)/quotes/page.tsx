import type { Metadata } from "next";
import { Placeholder } from "@/components/app/Placeholder";

export const metadata: Metadata = { title: "My quotes" };

export default function Page() {
  return <Placeholder title="My quotes" icon="quotes" />;
}
