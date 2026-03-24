import { AdminFooter, AdminTopBar } from "@/app/_components/AdminChrome";

export default function OpsLayout({
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
