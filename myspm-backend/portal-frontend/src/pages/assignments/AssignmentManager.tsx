import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Search, Clock, Users, CheckCircle2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useListAssignments } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";

export function AssignmentManager() {
  const { data, isLoading } = useListAssignments({ page: 1, limit: 10 });

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader 
        title="Assignments" 
        description="Manage active assignments and track student submissions."
        action={
          <Button className="rounded-xl shadow-lg shadow-primary/20 hover:shadow-xl hover:-translate-y-0.5">
            <Plus className="w-4 h-4 mr-2" />
            Create Assignment
          </Button>
        }
      />

      <div className="bg-card rounded-2xl border border-border/50 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-border/50 flex gap-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Search assignments..." className="pl-9 bg-background border-border/50 rounded-xl" />
          </div>
        </div>
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow className="border-border/50 hover:bg-transparent">
              <TableHead className="font-semibold">Assignment Title</TableHead>
              <TableHead className="font-semibold">Progress</TableHead>
              <TableHead className="font-semibold">Due Date</TableHead>
              <TableHead className="font-semibold">Status</TableHead>
              <TableHead className="text-right font-semibold">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="h-5 w-48" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                  <TableCell><Skeleton className="h-8 w-16 ml-auto" /></TableCell>
                </TableRow>
              ))
            ) : data?.data.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">
                  No assignments found.
                </TableCell>
              </TableRow>
            ) : (
              data?.data.map((assignment) => {
                const percent = Math.round((assignment.submissionCount / assignment.assignedCount) * 100) || 0;
                return (
                  <TableRow key={assignment.id} className="border-border/50 hover:bg-muted/30">
                    <TableCell>
                      <div className="font-medium text-foreground">{assignment.title}</div>
                      <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2">
                        <span className="truncate max-w-[200px]">{assignment.examTitle}</span>
                        <span className="w-1 h-1 rounded-full bg-border" />
                        {assignment.subject}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="w-full max-w-[120px] h-2 bg-muted rounded-full overflow-hidden">
                          <div className="h-full bg-primary" style={{ width: `${percent}%` }} />
                        </div>
                        <span className="text-xs font-medium text-muted-foreground">{assignment.submissionCount}/{assignment.assignedCount}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2 text-sm">
                        <Clock className="w-4 h-4 text-muted-foreground" />
                        {format(new Date(assignment.dueDate), 'MMM dd, yyyy')}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={assignment.status === 'Active' ? 'bg-emerald-500/10 text-emerald-600 border-emerald-200' : 'bg-muted text-muted-foreground'}>
                        {assignment.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" className="rounded-lg h-8 px-3 text-xs">View Report</Button>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
