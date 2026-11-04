import AuthPageServer from "@/components/AuthPageServer";

export const dynamic = "force-dynamic";

export default async function Page({ params, searchParams }: { params: Promise<{ segments?: string[] }>; searchParams: Promise<{ returnTo?: string; edit?: string; lang?: string }> }) {
  const [{ segments }, { returnTo, edit, lang }] = await Promise.all([params, searchParams]);
  return <AuthPageServer locale="en" segments={segments} returnTo={returnTo} edit={edit} lang={lang} />;
}
