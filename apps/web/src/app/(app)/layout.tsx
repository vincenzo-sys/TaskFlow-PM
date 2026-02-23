import { Sidebar } from '@/components/sidebar';
import { ToastProvider } from '@/components/toast';

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ToastProvider>
      <div className="flex h-screen">
        <Sidebar />
        <main className="flex-1 overflow-auto bg-paper-50">{children}</main>
      </div>
    </ToastProvider>
  );
}
