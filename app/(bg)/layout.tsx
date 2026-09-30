import SiteDocument from "@/components/SiteDocument";
export default function Layout({ children }: { children: React.ReactNode }) {
  return <SiteDocument locale="bg">{children}</SiteDocument>;
}
