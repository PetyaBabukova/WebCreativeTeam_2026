import { notFound } from "next/navigation";
import NewsletterDecision from "@/components/NewsletterDecision";

export const metadata = { robots: { index: false, follow: false } };
export default async function Page({ params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;
  if (action !== "confirm" && action !== "decline") notFound();
  return <NewsletterDecision locale="bg" action={action} />;
}
