import { AdminFooter, AdminTopBar } from "@/app/_components/AdminChrome";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <AdminTopBar />
      {children}
      <AdminFooter />
    </>
  );
}
