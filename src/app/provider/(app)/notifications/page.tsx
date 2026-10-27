import type { Metadata } from "next";
import { Placeholder } from "@/components/app/Placeholder";

export const metadata: Metadata = { title: "Notifications" };

export default function Page() {
  return <Placeholder title="Notifications" icon="bell" />;
}
