import * as React from "react"
import { toast } from "sonner"

import { HierarchicalMasterPanel } from "@/components/masters/hierarchical-master-panel"
import { MasterCrudPanel } from "@/components/masters/master-crud-panel"
import { AdminPage } from "@/components/layout/admin-page"
import {
  ListPageHeader,
  WorkspaceTabs,
  WorkspaceTabsContent,
  WorkspaceTabsList,
  WorkspaceTabsTrigger,
} from "@/components/layout/list-page-ui"
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
      <ListPageHeader
        title="Asset masters"
        description="Maintain reference data used across asset creation, import, and verification."
      />

      <WorkspaceTabs defaultValue="categories">
        <WorkspaceTabsList>
          <WorkspaceTabsTrigger value="categories">Categories</WorkspaceTabsTrigger>
          <WorkspaceTabsTrigger value="functional">Functional locations</WorkspaceTabsTrigger>
          <WorkspaceTabsTrigger value="actual">Actual locations</WorkspaceTabsTrigger>
          <WorkspaceTabsTrigger value="cost-centers">Cost centers</WorkspaceTabsTrigger>
          <WorkspaceTabsTrigger value="profit-centers">Profit centers</WorkspaceTabsTrigger>
          <WorkspaceTabsTrigger value="tag-colors">Tag colors</WorkspaceTabsTrigger>
        </WorkspaceTabsList>

        <WorkspaceTabsContent value="categories">
          <MasterCrudPanel
            title="Asset category"
            listUrl="/admin/asset-masters/categories?active_only=false"
            kind="category"
          />
        </WorkspaceTabsContent>
        <WorkspaceTabsContent value="functional">
          <HierarchicalMasterPanel
            title="Functional location"
            kind="functional-location"
            plants={plants}
          />
        </WorkspaceTabsContent>
        <WorkspaceTabsContent value="actual">
          <HierarchicalMasterPanel
            title="Actual location"
            kind="actual-location"
            plants={plants}
          />
        </WorkspaceTabsContent>
        <WorkspaceTabsContent value="cost-centers">
          <HierarchicalMasterPanel
            title="Cost center"
            kind="cost-center"
            plants={plants}
          />
        </WorkspaceTabsContent>
        <WorkspaceTabsContent value="profit-centers">
          <HierarchicalMasterPanel
            title="Profit center"
            kind="profit-center"
            plants={plants}
          />
        </WorkspaceTabsContent>
        <WorkspaceTabsContent value="tag-colors">
          <MasterCrudPanel
            title="Tag color"
            listUrl="/admin/asset-masters/tag-colors?active_only=false"
            kind="tag-color"
          />
        </WorkspaceTabsContent>
      </WorkspaceTabs>
    </AdminPage>
  )
}
