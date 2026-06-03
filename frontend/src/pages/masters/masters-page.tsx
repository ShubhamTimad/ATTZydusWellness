import * as React from "react"
import { toast } from "sonner"

import { HierarchicalMasterPanel } from "@/components/masters/hierarchical-master-panel"
import { MasterCrudPanel } from "@/components/masters/master-crud-panel"
import { AdminPage } from "@/components/layout/admin-page"
import { adminTabsListClass, adminTabsTriggerClass } from "@/components/layout/admin-ui"
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
      <Tabs defaultValue="categories" className="w-full gap-[var(--app-section-gap)]">
        <TabsList className={adminTabsListClass}>
          <TabsTrigger value="categories" className={adminTabsTriggerClass}>
            Categories
          </TabsTrigger>
          <TabsTrigger value="functional" className={adminTabsTriggerClass}>
            Functional locations
          </TabsTrigger>
          <TabsTrigger value="actual" className={adminTabsTriggerClass}>
            Actual locations
          </TabsTrigger>
          <TabsTrigger value="cost-centers" className={adminTabsTriggerClass}>
            Cost centers
          </TabsTrigger>
          <TabsTrigger value="profit-centers" className={adminTabsTriggerClass}>
            Profit centers
          </TabsTrigger>
          <TabsTrigger value="tag-colors" className={adminTabsTriggerClass}>
            Tag colors
          </TabsTrigger>
        </TabsList>
        <TabsContent value="categories" className="mt-0">
          <MasterCrudPanel
            title="Asset category"
            listUrl="/admin/asset-masters/categories?active_only=false"
            kind="category"
          />
        </TabsContent>
        <TabsContent value="functional" className="mt-0">
          <HierarchicalMasterPanel
            title="Functional location"
            kind="functional-location"
            plants={plants}
          />
        </TabsContent>
        <TabsContent value="actual" className="mt-0">
          <HierarchicalMasterPanel
            title="Actual location"
            kind="actual-location"
            plants={plants}
          />
        </TabsContent>
        <TabsContent value="cost-centers" className="mt-0">
          <HierarchicalMasterPanel
            title="Cost center"
            kind="cost-center"
            plants={plants}
          />
        </TabsContent>
        <TabsContent value="profit-centers" className="mt-0">
          <HierarchicalMasterPanel
            title="Profit center"
            kind="profit-center"
            plants={plants}
          />
        </TabsContent>
        <TabsContent value="tag-colors" className="mt-0">
          <MasterCrudPanel
            title="Tag color"
            listUrl="/admin/asset-masters/tag-colors?active_only=false"
            kind="tag-color"
          />
        </TabsContent>
      </Tabs>
    </AdminPage>
  )
}
