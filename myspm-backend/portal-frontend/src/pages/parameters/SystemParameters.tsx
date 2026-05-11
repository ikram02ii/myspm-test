import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Edit2, Settings } from "lucide-react";
import { useListSystemParameters } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

export function SystemParameters() {
  const { data, isLoading } = useListSystemParameters({});

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader 
        title="System Parameters" 
        description="Global platform configuration and defaults."
      />

      <div className="bg-card rounded-2xl border border-border/50 shadow-sm overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow className="border-border/50 hover:bg-transparent">
              <TableHead className="font-semibold w-[250px]">Parameter Name</TableHead>
              <TableHead className="font-semibold w-[150px]">Category</TableHead>
              <TableHead className="font-semibold">Value</TableHead>
              <TableHead className="font-semibold">Description</TableHead>
              <TableHead className="text-right font-semibold">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="h-5 w-48" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-8 w-16" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-full" /></TableCell>
                  <TableCell><Skeleton className="h-8 w-8 ml-auto" /></TableCell>
                </TableRow>
              ))
            ) : data?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">
                  No parameters found.
                </TableCell>
              </TableRow>
            ) : (
              data?.map((param) => (
                <TableRow key={param.id} className="border-border/50 hover:bg-muted/30">
                  <TableCell className="font-mono text-xs text-foreground font-semibold">
                    {param.name}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="bg-muted font-normal">{param.category}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="font-medium bg-primary/10 text-primary px-3 py-1 rounded-md inline-block">
                      {param.value}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {param.description}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
                      <Edit2 className="w-4 h-4" />
                    </Button>
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
