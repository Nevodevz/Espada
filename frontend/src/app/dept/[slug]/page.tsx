import { redirect } from "next/navigation";
import { salesDeptTarget, type PageSearchParams } from "@/lib/redirectQuery";
import { DeptPageClient } from "./DeptPageClient";

/** `/dept/sales` is gone (spec §4): its screens moved to «Показатели» and «Встречи». */
export default function DeptPage({ params, searchParams }: { params: { slug: string }; searchParams: PageSearchParams }) {
  if (params.slug === "sales") redirect(salesDeptTarget(searchParams));
  return <DeptPageClient />;
}
