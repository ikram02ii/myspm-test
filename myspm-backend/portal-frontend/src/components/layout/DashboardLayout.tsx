import { ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { TopNav } from "./TopNav";

export function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background flex w-full">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <TopNav />
        <main className="flex-1 p-4 sm:p-8 overflow-y-auto">
          <div className="max-w-7xl mx-auto w-full">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
