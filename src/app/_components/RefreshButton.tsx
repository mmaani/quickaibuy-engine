"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

export default function RefreshButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <button
      onClick={() => {
        startTransition(() => {
          router.refresh();
        });
      }}
      disabled={isPending}
      style={{
        padding: "10px 14px",
        borderRadius: 10,
        border: "1px solid #d0d7de",
        background: isPending ? "#f6f8fa" : "#111827",
        color: isPending ? "#6b7280" : "#ffffff",
        cursor: isPending ? "not-allowed" : "pointer",
        fontWeight: 600,
      }}
    >
      {isPending ? "Refreshing..." : "Refresh"}
    </button>
  );
}
