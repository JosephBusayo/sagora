import { redirect } from "next/navigation";

/**
 * Superseded: /request now offers the choice between a form and a voice note in one place
 * (RequestEntry), per Joseph's "one button, not two". Kept so any old link still lands somewhere.
 */
export default async function Page({ searchParams }: { searchParams: Promise<{ provider?: string }> }) {
  const { provider } = await searchParams;
  redirect(provider ? `/request?provider=${provider}` : "/request");
}
