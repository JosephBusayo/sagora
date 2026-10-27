import { redirect } from "next/navigation";

// The public home page is outside this assignment; send people to the provider sign-in for now.
export default function Home() {
  redirect("/provider/sign-in");
}
