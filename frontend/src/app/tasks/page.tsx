import { redirect } from "next/navigation";
import { withQuery, type PageSearchParams } from "@/lib/redirectQuery";

/** Legacy route: «Мои задачи» became part of «Сегодня» (`?assignee=` is kept). */
export default function TasksRedirectPage({ searchParams }: { searchParams: PageSearchParams }) {
  redirect(withQuery("/sales/today", searchParams));
}
