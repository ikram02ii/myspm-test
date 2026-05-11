import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { useListQuestions, useArchiveQuestion, useDuplicateQuestion } from "@workspace/api-client-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, Plus, Sparkles, Filter, MoreHorizontal, Eye, Copy, Edit, Trash2 } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

export function QuestionBank() {
  const [search, setSearch] = useState("");
  const { data, isLoading } = useListQuestions({ page: 1, limit: 10, search });
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const archiveMutation = useArchiveQuestion({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/questions"] });
        toast({ title: "Question archived successfully" });
      }
    }
  });

  const duplicateMutation = useDuplicateQuestion({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/questions"] });
        toast({ title: "Question duplicated successfully" });
      }
    }
  });

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader 
        title="Question Bank" 
        description="Manage and generate questions for exams and practice sets."
        action={
          <>
            <Button variant="outline" className="rounded-xl border-border/50 bg-card hover:bg-accent">
              <Sparkles className="w-4 h-4 mr-2 text-primary" />
              Generate AI Questions
            </Button>
            <Button className="rounded-xl shadow-lg shadow-primary/20 hover:shadow-xl hover:-translate-y-0.5 transition-all">
              <Plus className="w-4 h-4 mr-2" />
              Create Question
            </Button>
          </>
        }
      />

      <div className="flex flex-col sm:flex-row gap-4 bg-card p-4 rounded-2xl border border-border/50 shadow-sm">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input 
            placeholder="Search by text, topic, or subject..." 
            className="pl-9 bg-background border-border/50 rounded-xl"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button variant="outline" className="rounded-xl border-border/50 gap-2 shrink-0">
          <Filter className="w-4 h-4" /> Filters
        </Button>
      </div>

      <div className="bg-card rounded-2xl border border-border/50 shadow-sm overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow className="border-border/50 hover:bg-transparent">
              <TableHead className="w-20 font-semibold">ID</TableHead>
              <TableHead className="font-semibold">Subject & Topic</TableHead>
              <TableHead className="font-semibold">Type</TableHead>
              <TableHead className="font-semibold">Difficulty</TableHead>
              <TableHead className="font-semibold">Status</TableHead>
              <TableHead className="text-right font-semibold">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="h-5 w-12" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-48" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                  <TableCell><Skeleton className="h-8 w-8 ml-auto rounded-md" /></TableCell>
                </TableRow>
              ))
            ) : data?.data.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                  No questions found.
                </TableCell>
              </TableRow>
            ) : (
              data?.data.map((q) => (
                <TableRow key={q.id} className="border-border/50 group hover:bg-muted/30 transition-colors">
                  <TableCell className="font-mono text-xs text-muted-foreground">#{q.id}</TableCell>
                  <TableCell>
                    <div className="font-medium text-foreground">{q.subject}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{q.topic}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="bg-background">{q.questionType}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className={
                      q.difficulty === 'Hard' ? 'bg-destructive/10 text-destructive hover:bg-destructive/20' : 
                      q.difficulty === 'Medium' ? 'bg-orange-500/10 text-orange-600 hover:bg-orange-500/20' : 
                      'bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20'
                    }>
                      {q.difficulty}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2 text-sm">
                      <div className={`w-2 h-2 rounded-full ${q.status === 'Active' ? 'bg-emerald-500' : 'bg-muted-foreground'}`} />
                      {q.status}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="opacity-0 group-hover:opacity-100 transition-opacity rounded-lg h-8 w-8">
                          <MoreHorizontal className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48 rounded-xl border-border/50 shadow-xl">
                        <DropdownMenuItem className="cursor-pointer gap-2"><Eye className="w-4 h-4" /> View Preview</DropdownMenuItem>
                        <DropdownMenuItem className="cursor-pointer gap-2"><Edit className="w-4 h-4" /> Edit Details</DropdownMenuItem>
                        <DropdownMenuItem className="cursor-pointer gap-2" onClick={() => duplicateMutation.mutate({ id: q.id })}><Copy className="w-4 h-4" /> Duplicate</DropdownMenuItem>
                        <DropdownMenuSeparator className="bg-border/50" />
                        <DropdownMenuItem className="cursor-pointer gap-2 text-destructive focus:bg-destructive/10 focus:text-destructive" onClick={() => archiveMutation.mutate({ id: q.id })}>
                          <Trash2 className="w-4 h-4" /> Archive
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
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
