import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useListRoles, useGetRole } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useState } from "react";
import { Shield, Save, Check } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

export function RbacManagement() {
  const { data: roles, isLoading: rolesLoading } = useListRoles();
  const [selectedRoleId, setSelectedRoleId] = useState<number | null>(null);
  const roleQuery = useGetRole(selectedRoleId ?? 0);
  const roleDetail = selectedRoleId ? roleQuery.data : undefined;
  const roleDetailLoading = selectedRoleId ? roleQuery.isLoading : false;

  // Auto-select first role when loaded
  if (!selectedRoleId && roles?.length && roles.length > 0) {
    setSelectedRoleId(roles[0].id);
  }

  return (
    <div className="space-y-6 h-[calc(100vh-8rem)] flex flex-col animate-in fade-in duration-500">
      <PageHeader 
        title="RBAC Management" 
        description="Configure Role-Based Access Control matrix."
        action={
          <Button className="rounded-xl shadow-lg shadow-primary/20">
            <Save className="w-4 h-4 mr-2" /> Save Changes
          </Button>
        }
      />

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-4 gap-6 min-h-0">
        {/* Roles List */}
        <Card className="shadow-sm border-border/50 h-full overflow-hidden flex flex-col">
          <CardHeader className="border-b border-border/50 bg-muted/20 py-4">
            <CardTitle className="text-base flex items-center gap-2"><Shield className="w-4 h-4 text-primary" /> Roles</CardTitle>
          </CardHeader>
          <CardContent className="p-0 flex-1 overflow-y-auto">
            {rolesLoading ? (
              <div className="p-4 space-y-2">
                <Skeleton className="h-12 w-full rounded-lg" />
                <Skeleton className="h-12 w-full rounded-lg" />
              </div>
            ) : (
              <div className="flex flex-col">
                {roles?.map(role => (
                  <button
                    key={role.id}
                    onClick={() => setSelectedRoleId(role.id)}
                    className={cn(
                      "flex items-center justify-between p-4 text-left border-b border-border/50 transition-colors hover:bg-muted/50 focus:outline-none",
                      selectedRoleId === role.id ? "bg-primary/5 border-l-4 border-l-primary" : "border-l-4 border-l-transparent"
                    )}
                  >
                    <div>
                      <div className="font-semibold text-sm">{role.name}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{role.userCount} users</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Permissions Matrix */}
        <Card className="lg:col-span-3 shadow-sm border-border/50 h-full overflow-hidden flex flex-col">
          <CardHeader className="border-b border-border/50 bg-muted/20 py-4">
            <CardTitle className="text-base">Permission Matrix {roleDetail && `- ${roleDetail.name}`}</CardTitle>
          </CardHeader>
          <CardContent className="p-0 flex-1 overflow-y-auto">
            {roleDetailLoading ? (
              <div className="p-8"><Skeleton className="w-full h-64" /></div>
            ) : !roleDetail ? (
              <div className="p-8 text-center text-muted-foreground">Select a role to view permissions</div>
            ) : (
              <table className="w-full text-sm text-left">
                <thead className="bg-muted/50 text-muted-foreground sticky top-0 z-10 shadow-sm">
                  <tr>
                    <th className="px-6 py-4 font-semibold w-1/3">Module</th>
                    <th className="px-6 py-4 font-semibold text-center">View</th>
                    <th className="px-6 py-4 font-semibold text-center">Create</th>
                    <th className="px-6 py-4 font-semibold text-center">Edit</th>
                    <th className="px-6 py-4 font-semibold text-center">Delete</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {roleDetail.permissions.map((perm, idx) => (
                    <tr key={idx} className="hover:bg-muted/20">
                      <td className="px-6 py-4 font-medium">{perm.module}</td>
                      <td className="px-6 py-4 text-center">
                        <Checkbox checked={perm.canView} className="rounded-md mx-auto" />
                      </td>
                      <td className="px-6 py-4 text-center">
                        <Checkbox checked={perm.canCreate} className="rounded-md mx-auto" />
                      </td>
                      <td className="px-6 py-4 text-center">
                        <Checkbox checked={perm.canEdit} className="rounded-md mx-auto" />
                      </td>
                      <td className="px-6 py-4 text-center">
                        <Checkbox checked={perm.canDelete} className="rounded-md mx-auto" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
