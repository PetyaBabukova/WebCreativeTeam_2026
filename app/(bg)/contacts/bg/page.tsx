import SitePage from "@/components/SitePage";
import { pageMetadata } from "@/lib/metadata";

export function generateMetadata() { return pageMetadata("contacts", "bg"); }
export default function Page() { return <SitePage locale="bg" page="contacts" />; }
