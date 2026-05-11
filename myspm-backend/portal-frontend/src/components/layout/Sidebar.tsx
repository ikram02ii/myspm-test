import { Link, useLocation } from "wouter";
import { 
  LayoutDashboard, Database, FileText, ClipboardList, 
  FolderPen, BookOpen, MessageSquare, GraduationCap, 
  BarChart3, Users, ShieldCheck, Settings, ListTree,
  LogOut, CreditCard,
  ChevronDown
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

const MENU_GROUPS = [
  {
    title: "Overview",
    items: [
      { name: "Dashboard", icon: LayoutDashboard, href: "/" },
    ]
  },
  {
    title: "Academic Management",
    items: [
      { name: "Question Bank", icon: Database, href: "/questions" },
      { name: "Exams", icon: FileText, href: "/exams" },
      { name: "Assignments", icon: ClipboardList, href: "/assignments" },
    ]
  },
  {
    title: "Analytics",
    items: [
      { name: "Student Results", icon: GraduationCap, href: "/results" },
      { name: "Exam Analytics", icon: BarChart3, href: "/analytics" },
    ]
  },
  {
    title: "Teacher Content",
    items: [
      { name: "Practice Sets", icon: FolderPen, href: "/practice-sets" },
      { name: "Study Notes", icon: BookOpen, href: "/study-notes" },
      { name: "Teacher Posts", icon: MessageSquare, href: "/teacher-posts" },
    ]
  },
  {
    title: "Subscriptions",
    items: [
      { name: "My Subscription", icon: CreditCard, href: "/subscriptions/student" },
      { name: "Teacher Packages", icon: Users, href: "/subscriptions/teacher" },
      { name: "Subscription Manager", icon: ShieldCheck, href: "/subscriptions/admin" },
    ]
  },
  {
    title: "Administration",
    items: [
      { name: "User Management", icon: Users, href: "/users" },
      { name: "RBAC", icon: ShieldCheck, href: "/roles" },
      { name: "System Parameters", icon: Settings, href: "/parameters" },
      { name: "LOV Management", icon: ListTree, href: "/lov" },
    ]
  }
];

export function Sidebar() {
  const [location] = useLocation();

  return (
    <aside className="w-64 h-screen border-r border-border bg-card flex flex-col hidden lg:flex sticky top-0 left-0">
      <div className="h-16 flex items-center px-6 border-b border-border/50">
        <div className="flex items-center gap-2 text-primary font-display font-bold text-xl tracking-tight">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center text-primary-foreground shadow-sm">
            <GraduationCap className="w-5 h-5" />
          </div>
          MySPM
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto py-6 px-4 space-y-6">
        {MENU_GROUPS.map((group, idx) => (
          <Collapsible defaultOpen key={idx}>
            <CollapsibleTrigger className="flex w-full items-center justify-between text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-2 hover:text-foreground transition-colors group">
              {group.title}
              <ChevronDown className="w-3 h-3 opacity-50 group-data-[state=open]:rotate-180 transition-transform" />
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-1">
              {group.items.map((item) => {
                const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
                return (
                  <Link 
                    key={item.href} 
                    href={item.href}
                    className={cn(
                      "flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 text-sm font-medium",
                      isActive 
                        ? "bg-primary/10 text-primary" 
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    <item.icon className={cn("w-4 h-4", isActive ? "text-primary" : "text-muted-foreground")} />
                    {item.name}
                  </Link>
                );
              })}
            </CollapsibleContent>
          </Collapsible>
        ))}
      </div>

      <div className="p-4 border-t border-border/50">
        <button className="flex w-full items-center gap-3 px-3 py-2.5 rounded-xl transition-colors text-sm font-medium text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
          <LogOut className="w-4 h-4" />
          Sign Out
        </button>
      </div>
    </aside>
  );
}
