import { preload } from "react-dom";
import { Landing } from "@/components/landing/Landing";
import { WhatsAppButton } from "@/components/contact/WhatsAppButton";

export default function Home() {
  // The two top hero photos are on the first screen: start fetching them with the page.
  preload("/img/hero-tl.webp", { as: "image", fetchPriority: "high" });
  preload("/img/hero-tr.webp", { as: "image", fetchPriority: "high" });
  return (
    <>
      <Landing />
      <WhatsAppButton />
    </>
  );
}
