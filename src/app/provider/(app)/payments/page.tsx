import type { Metadata } from "next";
import { Placeholder } from "@/components/app/Placeholder";

export const metadata: Metadata = { title: "Payments" };

export default function Page() {
  return <Placeholder title="Payments" icon="payments" />;
}
