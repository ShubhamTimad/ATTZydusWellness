import * as React from "react"
import { toast } from "sonner"

import { HierarchicalMasterPanel } from "@/components/masters/hierarchical-master-panel"
import { MasterCrudPanel } from "@/components/masters/master-crud-panel"
import { AdminPage } from "@/components/layout/admin-page"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { getJson } from "@/lib/api"
import type { PlantOption } from "@/lib/masters-types"
import { canListOrgUnitsForAssignments } from "@/lib/permissions"

export function MastersPage() {
  const [plants, setPlants] = React.useState<PlantOption[]>([])

  React.useEffect(() => {
    if (!canListOrgUnitsForAssignments()) return
    void getJson<PlantOption[]>("/admin/org-units?type=PLANT")
      .then(setPlants)
      .catch(() => toast.error("Could not load plants."))
  }, [])

  return (
    <AdminPage fullWidth>
      <Tabs defaultValue="categories" className="w-full">
        <TabsList className="h-9 flex-wrap">
          <TabsTrigger value="categories">Categories</TabsTrigger>
          <TabsTrigger value="functional">Functional locations</TabsTrigger>
          <TabsTrigger value="actual">Actual locations</TabsTrigger>
          <TabsTrigger value="cost-centers">Cost centers</TabsTrigger>
          <TabsTrigger value="profit-centers">Profit centers</TabsTrigger>
        </TabsList>
        <TabsContent value="categories" className="mt-3">
          <MasterCrudPanel
            title="Asset category"
            listUrl="/admin/asset-masters/categories?active_only=false"
            kind="category"
          />
        </TabsContent>
        <TabsContent value="functional" className="mt-3">
          <HierarchicalMasterPanel
            title="Functional location"
            kind="functional-location"
            plants={plants}
          />
        </TabsContent>
        <TabsContent value="actual" className="mt-3">
          <HierarchicalMasterPanel
            title="Actual location"
            kind="actual-location"
            plants={plants}
          />
        </TabsContent>
        <TabsContent value="cost-centers" className="mt-3">
          <HierarchicalMasterPanel
            title="Cost center"
            kind="cost-center"
            plants={plants}
          />
        </TabsContent>
        <TabsContent value="profit-centers" className="mt-3">
          <HierarchicalMasterPanel
            title="Profit center"
            kind="profit-center"
            plants={plants}
          />
        </TabsContent>
      </Tabs>
    </AdminPage>
  )
}
