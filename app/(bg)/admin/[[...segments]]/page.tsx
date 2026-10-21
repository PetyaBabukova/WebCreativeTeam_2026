import AuthPageServer from "@/components/AuthPageServer";

export const dynamic = "force-dynamic";

export default async function Page({ params, searchParams }: { params: Promise<{ segments?: string[] }>; searchParams: Promise<{ returnTo?: string }> }) {
  const [{ segments }, { returnTo }] = await Promise.all([params, searchParams]);
  return <AuthPageServer locale="bg" segments={segments} returnTo={returnTo} />;
}
