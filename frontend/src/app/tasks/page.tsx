"use client";

import { Suspense } from "react";
import { Shell } from "@/components/Shell";
import { MyTasksBlock } from "@/components/sales/MyTasksBlock";

export default function MyTasksPage() {
  return (
    <Shell title="Мои задачи">
      <Suspense fallback={<div style={{ padding: 30 }}>Загрузка…</div>}><MyTasksBlock /></Suspense>
    </Shell>
  );
}
