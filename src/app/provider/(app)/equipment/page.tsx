import type { Metadata } from "next";
import { Placeholder } from "@/components/app/Placeholder";

export const metadata: Metadata = { title: "Equipment" };

export default function Page() {
  return <Placeholder title="Equipment" icon="equipment" />;
}
