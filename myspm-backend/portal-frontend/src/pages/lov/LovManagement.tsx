import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useListLovCategories, useListLovValues } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useState } from "react";
import { ListTree, Plus, Edit2, ToggleLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

export function LovManagement() {
  const { data: categories, isLoading: categoriesLoading } = useListLovCategories();
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const lovValuesQuery = useListLovValues(selectedCategoryId ?? 0);
  const values = selectedCategoryId ? lovValuesQuery.data : undefined;
  const valuesLoading = selectedCategoryId ? lovValuesQuery.isLoading : false;

  if (!selectedCategoryId && categories?.length && categories.length > 0) {
    setSelectedCategoryId(categories[0].id);
  }

  const selectedCategory = categories?.find(c => c.id === selectedCategoryId);

  return (
    <div className="space-y-6 h-[calc(100vh-8rem)] flex flex-col animate-in fade-in duration-500">
      <PageHeader 
        title="LOV Management" 
        description="Manage List of Values (dropdowns) across the system."
      />

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-4 gap-6 min-h-0">
        <Card className="shadow-sm border-border/50 h-full overflow-hidden flex flex-col">
          <CardHeader className="border-b border-border/50 bg-muted/20 py-4">
            <CardTitle className="text-base flex items-center gap-2"><ListTree className="w-4 h-4 text-primary" /> Categories</CardTitle>
          </CardHeader>
          <CardContent className="p-0 flex-1 overflow-y-auto">
            {categoriesLoading ? (
              <div className="p-4 space-y-2">
                <Skeleton className="h-12 w-full rounded-lg" />
                <Skeleton className="h-12 w-full rounded-lg" />
              </div>
            ) : (
              <div className="flex flex-col">
                {categories?.map(cat => (
                  <button
                    key={cat.id}
                    onClick={() => setSelectedCategoryId(cat.id)}
                    className={cn(
                      "flex items-center justify-between p-4 text-left border-b border-border/50 transition-colors hover:bg-muted/50 focus:outline-none",
                      selectedCategoryId === cat.id ? "bg-primary/5 border-l-4 border-l-primary" : "border-l-4 border-l-transparent"
                    )}
                  >
                    <div>
                      <div className="font-semibold text-sm">{cat.name}</div>
                      <div className="text-xs font-mono text-muted-foreground mt-0.5">{cat.code}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-3 shadow-sm border-border/50 h-full overflow-hidden flex flex-col">
          <CardHeader className="border-b border-border/50 bg-card py-4 flex flex-row items-center justify-between">
            <CardTitle className="text-base">{selectedCategory?.name || 'Values'}</CardTitle>
            <Button size="sm" className="h-8 rounded-lg" disabled={!selectedCategoryId}>
              <Plus className="w-3.5 h-3.5 mr-2" /> Add Value
            </Button>
          </CardHeader>
          <div className="flex-1 overflow-y-auto">
            <Table>
              <TableHeader className="bg-muted/50 sticky top-0 z-10 shadow-sm">
                <TableRow className="border-border/50 hover:bg-transparent">
                  <TableHead className="font-semibold">Code</TableHead>
                  <TableHead className="font-semibold">English</TableHead>
                  <TableHead className="font-semibold">Bahasa Melayu</TableHead>
                  <TableHead className="font-semibold">Order</TableHead>
                  <TableHead className="font-semibold">Status</TableHead>
                  <TableHead className="text-right font-semibold">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {valuesLoading ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-8" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                      <TableCell><Skeleton className="h-8 w-16 ml-auto" /></TableCell>
                    </TableRow>
                  ))
                ) : !values || values.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                      No values found for this category.
                    </TableCell>
                  </TableRow>
                ) : (
                  values.map(val => (
                    <TableRow key={val.id} className="border-border/50 hover:bg-muted/30">
                      <TableCell className="font-mono text-xs font-medium">{val.code}</TableCell>
                      <TableCell className="font-medium text-foreground">{val.displayNameEn}</TableCell>
                      <TableCell className="text-muted-foreground">{val.displayNameMs || '-'}</TableCell>
                      <TableCell>{val.sortOrder}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={val.status === 'Active' ? 'bg-emerald-500/10 text-emerald-600 border-emerald-200' : 'bg-muted text-muted-foreground'}>
                          {val.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground"><Edit2 className="w-4 h-4"/></Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground"><ToggleLeft className="w-4 h-4"/></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </Card>
      </div>
    </div>
  );
}
