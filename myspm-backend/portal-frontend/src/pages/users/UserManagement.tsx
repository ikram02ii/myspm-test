import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Search, Shield, Settings, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useListUsers } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";

export function UserManagement() {
  const { data, isLoading } = useListUsers({ page: 1, limit: 10 });

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader 
        title="User Management" 
        description="Manage teachers, administrators, and their access levels."
        action={
          <Button className="rounded-xl shadow-lg shadow-primary/20 hover:shadow-xl hover:-translate-y-0.5">
            <Plus className="w-4 h-4 mr-2" />
            Add User
          </Button>
        }
      />

      <div className="flex flex-col sm:flex-row gap-4 bg-card p-4 rounded-2xl border border-border/50 shadow-sm">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search users by name or email..." className="pl-9 bg-background border-border/50 rounded-xl" />
        </div>
      </div>

      <div className="bg-card rounded-2xl border border-border/50 shadow-sm overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow className="border-border/50 hover:bg-transparent">
              <TableHead className="font-semibold">User Details</TableHead>
              <TableHead className="font-semibold">Role</TableHead>
              <TableHead className="font-semibold">School/Organization</TableHead>
              <TableHead className="font-semibold">Status</TableHead>
              <TableHead className="text-right font-semibold">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="h-10 w-48" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                  <TableCell><Skeleton className="h-8 w-16 ml-auto" /></TableCell>
                </TableRow>
              ))
            ) : data?.data.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">
                  No users found.
                </TableCell>
              </TableRow>
            ) : (
              data?.data.map((user) => (
                <TableRow key={user.id} className="border-border/50 hover:bg-muted/30">
                  <TableCell>
                    <div className="font-medium text-foreground">{user.name}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{user.email}</div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5 text-sm font-medium">
                      <Shield className="w-3.5 h-3.5 text-primary" />
                      {user.role}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {user.school || 'System Default'}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={user.status === 'Active' ? 'bg-emerald-500/10 text-emerald-600 border-emerald-200' : 'bg-muted text-muted-foreground'}>
                      {user.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
                        <Settings className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10">
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
