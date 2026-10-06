import { notFound } from "next/navigation";
import { ServicePage } from "@/components/SitePage";
import { serviceMetadata } from "@/lib/metadata";
import { isServiceSlug } from "@/lib/routing";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  if (!isServiceSlug(slug)) notFound();
  return serviceMetadata(slug, "en");
}

export default async function Page({ params }: Props) {
  const { slug } = await params;
  if (!isServiceSlug(slug)) notFound();
  return <ServicePage locale="en" slug={slug} />;
}
