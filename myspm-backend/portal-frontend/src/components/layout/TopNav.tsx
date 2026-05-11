import { Search, Bell, Menu, LogOut } from "lucide-react";
import { useLocation } from "wouter";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/auth-context";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

export function TopNav() {
  const { user, logout } = useAuth();
  const [, setLocation] = useLocation();

  function handleLogout() {
    logout();
    setLocation("/login");
  }

  const initials =
    user?.name
      ?.split(/\s+/)
      .map((p) => p[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "—";

  return (
    <header className="h-16 border-b border-border/50 bg-background/80 backdrop-blur-md sticky top-0 z-40 flex items-center justify-between px-4 sm:px-8">
      <div className="flex items-center gap-4 flex-1">
        <Button variant="ghost" size="icon" className="lg:hidden">
          <Menu className="w-5 h-5" />
        </Button>
        <div className="relative w-full max-w-md hidden sm:block">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input 
            placeholder="Search questions, exams, or students..." 
            className="pl-9 bg-card border-border/50 rounded-full focus-visible:ring-primary/20 h-10"
          />
        </div>
      </div>
      
      <div className="flex items-center gap-3 sm:gap-4">
        <Button variant="ghost" size="icon" className="relative text-muted-foreground hover:text-foreground">
          <Bell className="w-5 h-5" />
          <span className="absolute top-2 right-2 w-2 h-2 bg-destructive rounded-full border-2 border-background"></span>
        </Button>
        
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="relative h-9 w-9 rounded-full">
              <Avatar className="h-9 w-9 border border-border/50 shadow-sm">
                <AvatarFallback>{initials}</AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56" align="end" forceMount>
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium leading-none">{user?.name ?? "User"}</p>
                <p className="text-xs leading-none text-muted-foreground">
                  {user?.email ?? ""}
                </p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled>Role: {user?.role ?? "—"}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:bg-destructive/10"
              onSelect={() => handleLogout()}
            >
              <LogOut className="mr-2 h-4 w-4" />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
