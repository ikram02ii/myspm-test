import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Plus, Search, Filter, Settings, FileText, Trash2 } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useListExams, useDeleteExam } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

export function ExamList() {
  const { data, isLoading } = useListExams({ page: 1, limit: 10 });
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const deleteMutation = useDeleteExam({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/exams"] });
        toast({ title: "Exam deleted successfully" });
      }
    }
  });

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader 
        title="Exams" 
        description="Create and manage examination papers."
        action={
          <Link href="/exams/new" className="inline-flex items-center justify-center rounded-xl text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2 shadow-lg shadow-primary/20 hover:shadow-xl hover:-translate-y-0.5">
            <Plus className="w-4 h-4 mr-2" />
            Create Exam
          </Link>
        }
      />

      <div className="flex flex-col sm:flex-row gap-4 bg-card p-4 rounded-2xl border border-border/50 shadow-sm">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search exams by title or subject..." className="pl-9 bg-background border-border/50 rounded-xl" />
        </div>
        <Button variant="outline" className="rounded-xl border-border/50 gap-2 shrink-0">
          <Filter className="w-4 h-4" /> Filters
        </Button>
      </div>

      <div className="bg-card rounded-2xl border border-border/50 shadow-sm overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow className="border-border/50 hover:bg-transparent">
              <TableHead className="font-semibold">Exam Details</TableHead>
              <TableHead className="font-semibold">Subject & Level</TableHead>
              <TableHead className="font-semibold">Questions</TableHead>
              <TableHead className="font-semibold">Created Date</TableHead>
              <TableHead className="text-right font-semibold">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="h-5 w-48" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-8 w-16 ml-auto rounded-md" /></TableCell>
                </TableRow>
              ))
            ) : data?.data.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">
                  No exams found.
                </TableCell>
              </TableRow>
            ) : (
              data?.data.map((exam) => (
                <TableRow key={exam.id} className="border-border/50 hover:bg-muted/30 transition-colors">
                  <TableCell>
                    <div className="font-medium text-foreground flex items-center gap-2">
                      <FileText className="w-4 h-4 text-primary/70" />
                      {exam.title}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2">
                      <Badge variant="secondary" className="text-[10px] h-4 px-1.5">{exam.status}</Badge>
                      {exam.timer ? `${exam.timer} mins` : 'No Timer'}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm font-medium">{exam.subject}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{exam.formLevel}</div>
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{exam.questionCount || 0}</div>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">{format(new Date(exam.createdAt), 'MMM dd, yyyy')}</div>
                    <div className="text-xs text-muted-foreground">by {exam.createdBy}</div>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Link href={`/exams/${exam.id}`}>
                        <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground">
                          <Settings className="w-4 h-4" />
                        </Button>
                      </Link>
                      <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10" onClick={() => deleteMutation.mutate({ id: exam.id })}>
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
