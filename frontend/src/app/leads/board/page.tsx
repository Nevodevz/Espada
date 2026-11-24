import { redirect } from "next/navigation";
import { withQuery, type PageSearchParams } from "@/lib/redirectQuery";

/** Legacy route: the board is the `view=board` of «Лиды». Alert links like `?overdue=true` keep their toggle. */
export default function LeadBoardRedirectPage({ searchParams }: { searchParams: PageSearchParams }) {
  redirect(withQuery("/leads", searchParams, { view: "board" }));
}
