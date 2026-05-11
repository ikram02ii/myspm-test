import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, Plus, Filter, MoreHorizontal, Eye, Edit, Trash2, Copy } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

const PRACTICE_SETS = [
  { id: 1, title: "Algebra Fundamentals Practice", subject: "Mathematics", formLevel: "Form 4", questionCount: 15, status: "published", createdBy: "Ahmad bin Ibrahim", createdAt: "2026-03-10" },
  { id: 2, title: "Biology Cell Structure Review", subject: "Science", formLevel: "Form 4", questionCount: 12, status: "published", createdBy: "Siti Nurhailza", createdAt: "2026-03-08" },
  { id: 3, title: "SPM English Comprehension Prep", subject: "English", formLevel: "Form 5", questionCount: 20, status: "published", createdBy: "Ahmad bin Ibrahim", createdAt: "2026-03-05" },
  { id: 4, title: "Sejarah Bab 1-3 Revision", subject: "History", formLevel: "Form 4", questionCount: 18, status: "draft", createdBy: "Siti Nurhailza", createdAt: "2026-03-03" },
  { id: 5, title: "Physics Forces & Motion", subject: "Science", formLevel: "Form 5", questionCount: 10, status: "published", createdBy: "Ahmad bin Ibrahim", createdAt: "2026-02-28" },
  { id: 6, title: "BM Karangan Latihan", subject: "Bahasa Melayu", formLevel: "Form 3", questionCount: 8, status: "draft", createdBy: "Siti Nurhailza", createdAt: "2026-02-25" },
];

export function PracticeSets() {
  const [search, setSearch] = useState("");

  const filtered = PRACTICE_SETS.filter(
    (ps) =>
      ps.title.toLowerCase().includes(search.toLowerCase()) ||
      ps.subject.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader
        title="Practice Sets"
        description="Curate standalone practice questions for student revision."
        action={
          <Button className="rounded-xl shadow-lg shadow-primary/20 hover:shadow-xl hover:-translate-y-0.5 transition-all">
            <Plus className="w-4 h-4 mr-2" />
            Create Practice Set
          </Button>
        }
      />

      <div className="flex flex-col sm:flex-row gap-4 bg-card p-4 rounded-2xl border border-border/50 shadow-sm">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by title or subject..."
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
              <TableHead className="font-semibold">Title</TableHead>
              <TableHead className="font-semibold">Subject & Level</TableHead>
              <TableHead className="font-semibold">Questions</TableHead>
              <TableHead className="font-semibold">Status</TableHead>
              <TableHead className="font-semibold">Created</TableHead>
              <TableHead className="text-right font-semibold">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                  No practice sets found.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((ps) => (
                <TableRow key={ps.id} className="border-border/50 group hover:bg-muted/30 transition-colors">
                  <TableCell>
                    <div className="font-medium text-foreground">{ps.title}</div>
                  </TableCell>
                  <TableCell>
                    <div className="font-medium text-sm">{ps.subject}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{ps.formLevel}</div>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm font-medium">{ps.questionCount}</span>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className={
                      ps.status === 'published'
                        ? 'bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20'
                        : 'bg-orange-500/10 text-orange-600 hover:bg-orange-500/20'
                    }>
                      {ps.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm text-muted-foreground">{new Date(ps.createdAt).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">by {ps.createdBy}</div>
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="opacity-0 group-hover:opacity-100 transition-opacity rounded-lg h-8 w-8">
                          <MoreHorizontal className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48 rounded-xl border-border/50 shadow-xl">
                        <DropdownMenuItem className="cursor-pointer gap-2"><Eye className="w-4 h-4" /> Preview</DropdownMenuItem>
                        <DropdownMenuItem className="cursor-pointer gap-2"><Edit className="w-4 h-4" /> Edit</DropdownMenuItem>
                        <DropdownMenuItem className="cursor-pointer gap-2"><Copy className="w-4 h-4" /> Duplicate</DropdownMenuItem>
                        <DropdownMenuSeparator className="bg-border/50" />
                        <DropdownMenuItem className="cursor-pointer gap-2 text-destructive focus:bg-destructive/10 focus:text-destructive">
                          <Trash2 className="w-4 h-4" /> Delete
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
