import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, Plus, Filter, MoreHorizontal, Eye, Edit, Trash2, FileText } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

const STUDY_NOTES = [
  { id: 1, title: "Algebra & Linear Equations Summary", subject: "Mathematics", topic: "Algebra", formLevel: "Form 4", status: "published", updatedAt: "2026-03-12", author: "Ahmad bin Ibrahim", wordCount: 2400 },
  { id: 2, title: "Cell Division — Mitosis vs Meiosis", subject: "Science", topic: "Biology", formLevel: "Form 4", status: "published", updatedAt: "2026-03-10", author: "Siti Nurhailza", wordCount: 1850 },
  { id: 3, title: "Grammar Rules: Tenses Cheat Sheet", subject: "English", topic: "Grammar", formLevel: "Form 3", status: "published", updatedAt: "2026-03-08", author: "Ahmad bin Ibrahim", wordCount: 1200 },
  { id: 4, title: "Tokoh-tokoh Kemerdekaan Malaysia", subject: "History", topic: "Kemerdekaan", formLevel: "Form 4", status: "draft", updatedAt: "2026-03-05", author: "Siti Nurhailza", wordCount: 3100 },
  { id: 5, title: "Newton's Laws of Motion Explained", subject: "Science", topic: "Physics", formLevel: "Form 5", status: "published", updatedAt: "2026-03-01", author: "Ahmad bin Ibrahim", wordCount: 2000 },
  { id: 6, title: "Peribahasa & Simpulan Bahasa", subject: "Bahasa Melayu", topic: "Tatabahasa", formLevel: "Form 5", status: "draft", updatedAt: "2026-02-26", author: "Siti Nurhailza", wordCount: 1500 },
];

export function StudyNotes() {
  const [search, setSearch] = useState("");

  const filtered = STUDY_NOTES.filter(
    (note) =>
      note.title.toLowerCase().includes(search.toLowerCase()) ||
      note.subject.toLowerCase().includes(search.toLowerCase()) ||
      note.topic.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader
        title="Study Notes"
        description="Upload and manage reference materials for students."
        action={
          <Button className="rounded-xl shadow-lg shadow-primary/20 hover:shadow-xl hover:-translate-y-0.5 transition-all">
            <Plus className="w-4 h-4 mr-2" />
            Create Note
          </Button>
        }
      />

      <div className="flex flex-col sm:flex-row gap-4 bg-card p-4 rounded-2xl border border-border/50 shadow-sm">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by title, subject, or topic..."
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
              <TableHead className="font-semibold">Subject & Topic</TableHead>
              <TableHead className="font-semibold">Form</TableHead>
              <TableHead className="font-semibold">Length</TableHead>
              <TableHead className="font-semibold">Status</TableHead>
              <TableHead className="font-semibold">Last Updated</TableHead>
              <TableHead className="text-right font-semibold">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                  No study notes found.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((note) => (
                <TableRow key={note.id} className="border-border/50 group hover:bg-muted/30 transition-colors">
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                        <FileText className="w-4 h-4 text-primary" />
                      </div>
                      <span className="font-medium text-foreground">{note.title}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="font-medium text-sm">{note.subject}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{note.topic}</div>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm">{note.formLevel}</span>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm text-muted-foreground">{(note.wordCount / 1000).toFixed(1)}k words</span>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className={
                      note.status === 'published'
                        ? 'bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20'
                        : 'bg-orange-500/10 text-orange-600 hover:bg-orange-500/20'
                    }>
                      {note.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm text-muted-foreground">{new Date(note.updatedAt).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">by {note.author}</div>
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
