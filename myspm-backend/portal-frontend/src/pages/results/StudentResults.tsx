import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, Eye, Filter } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useListResults } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";

export function StudentResults() {
  const { data, isLoading } = useListResults({ page: 1, limit: 10 });

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader 
        title="Student Results" 
        description="Review exam attempts and AI-graded feedback."
      />

      <div className="flex flex-col sm:flex-row gap-4 bg-card p-4 rounded-2xl border border-border/50 shadow-sm">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search students or schools..." className="pl-9 bg-background border-border/50 rounded-xl" />
        </div>
        <Button variant="outline" className="rounded-xl border-border/50 gap-2 shrink-0">
          <Filter className="w-4 h-4" /> Filters
        </Button>
      </div>

      <div className="bg-card rounded-2xl border border-border/50 shadow-sm overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow className="border-border/50 hover:bg-transparent">
              <TableHead className="font-semibold">Student</TableHead>
              <TableHead className="font-semibold">Exam Info</TableHead>
              <TableHead className="font-semibold">Score</TableHead>
              <TableHead className="font-semibold">Date</TableHead>
              <TableHead className="text-right font-semibold">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="h-5 w-40" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-48" /></TableCell>
                  <TableCell><Skeleton className="h-8 w-16" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-8 w-8 ml-auto rounded-md" /></TableCell>
                </TableRow>
              ))
            ) : data?.data.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">
                  No results found.
                </TableCell>
              </TableRow>
            ) : (
              data?.data.map((result) => {
                const percent = Math.round((result.score / result.totalMarks) * 100);
                return (
                  <TableRow key={result.id} className="border-border/50 hover:bg-muted/30">
                    <TableCell>
                      <div className="font-medium text-foreground">{result.studentName}</div>
                      <div className="text-xs text-muted-foreground mt-1">{result.school}</div>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{result.examTitle}</div>
                      <div className="text-xs text-muted-foreground mt-1">{result.subject}</div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Badge variant="secondary" className={
                          percent >= 80 ? 'bg-emerald-500/10 text-emerald-600' : 
                          percent >= 50 ? 'bg-orange-500/10 text-orange-600' : 
                          'bg-destructive/10 text-destructive'
                        }>
                          {result.score}/{result.totalMarks} ({percent}%)
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {format(new Date(result.attemptDate), 'MMM dd, yyyy HH:mm')}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10">
                        <Eye className="w-4 h-4" />
                      </Button>
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
