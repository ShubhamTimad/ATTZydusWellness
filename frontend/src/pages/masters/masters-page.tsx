import * as React from "react"
import { toast } from "sonner"

import { HierarchicalMasterPanel } from "@/components/masters/hierarchical-master-panel"
import { MasterCrudPanel } from "@/components/masters/master-crud-panel"
import { CostCenterCustodiansPanel } from "@/components/masters/cost-center-custodians-panel"
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

const TAB_PANEL =
  "mt-0 flex min-h-0 flex-1 flex-col outline-none data-[state=inactive]:hidden"

export function MastersPage() {
  const [plants, setPlants] = React.useState<PlantOption[]>([])

  React.useEffect(() => {
    if (!canListOrgUnitsForAssignments()) return
    void getJson<PlantOption[]>("/admin/org-units?type=PLANT")
      .then(setPlants)
      .catch(() => toast.error("Could not load plants."))
  }, [])

  return (
    <AdminPage fullWidth dense viewportFill className="gap-[var(--app-grid-gap)]">
      <div className="flex min-h-0 flex-1 flex-col gap-[var(--app-grid-gap)]">
        <ListPageHeader className="shrink-0" title="Asset masters" description="" />

        <WorkspaceTabs
          defaultValue="categories"
          className="flex min-h-0 flex-1 flex-col gap-[var(--app-grid-gap)]"
        >
          <WorkspaceTabsList className="shrink-0">
          <WorkspaceTabsTrigger value="categories">Categories</WorkspaceTabsTrigger>
          <WorkspaceTabsTrigger value="asset-classes">Asset classes</WorkspaceTabsTrigger>
          <WorkspaceTabsTrigger value="functional">Functional locations</WorkspaceTabsTrigger>
            <WorkspaceTabsTrigger value="actual">Actual locations</WorkspaceTabsTrigger>
            <WorkspaceTabsTrigger value="cost-centers">Cost centers</WorkspaceTabsTrigger>
            <WorkspaceTabsTrigger value="cc-custodians">CC custodians</WorkspaceTabsTrigger>
            <WorkspaceTabsTrigger value="profit-centers">Profit centers</WorkspaceTabsTrigger>
            <WorkspaceTabsTrigger value="tag-colors">Tag colors</WorkspaceTabsTrigger>
            <WorkspaceTabsTrigger value="asset-conditions">Asset conditions</WorkspaceTabsTrigger>
          </WorkspaceTabsList>

        <WorkspaceTabsContent value="categories" className={TAB_PANEL}>
          <MasterCrudPanel
            title="Asset category"
            listUrl="/admin/asset-masters/categories?active_only=true"
            kind="category"
          />
        </WorkspaceTabsContent>
        <WorkspaceTabsContent value="asset-classes" className={TAB_PANEL}>
          <MasterCrudPanel
            title="Asset class"
            listUrl="/admin/asset-masters/asset-classes?active_only=true"
            kind="code-name"
          />
        </WorkspaceTabsContent>
        <WorkspaceTabsContent value="functional" className={TAB_PANEL}>
            <HierarchicalMasterPanel
              title="Functional location"
              kind="functional-location"
              plants={plants}
            />
          </WorkspaceTabsContent>
          <WorkspaceTabsContent value="actual" className={TAB_PANEL}>
            <HierarchicalMasterPanel
              title="Actual location"
              kind="actual-location"
              plants={plants}
            />
          </WorkspaceTabsContent>
          <WorkspaceTabsContent value="cost-centers" className={TAB_PANEL}>
            <HierarchicalMasterPanel title="Cost center" kind="cost-center" plants={plants} />
          </WorkspaceTabsContent>
          <WorkspaceTabsContent value="cc-custodians" className={TAB_PANEL}>
            <CostCenterCustodiansPanel plants={plants} />
          </WorkspaceTabsContent>
          <WorkspaceTabsContent value="profit-centers" className={TAB_PANEL}>
            <HierarchicalMasterPanel title="Profit center" kind="profit-center" plants={plants} />
          </WorkspaceTabsContent>
          <WorkspaceTabsContent value="tag-colors" className={TAB_PANEL}>
            <MasterCrudPanel
              title="Tag color"
              listUrl="/admin/asset-masters/tag-colors?active_only=true"
              kind="tag-color"
            />
          </WorkspaceTabsContent>
          <WorkspaceTabsContent value="asset-conditions" className={TAB_PANEL}>
            <MasterCrudPanel
              title="Asset condition"
              listUrl="/admin/asset-masters/asset-conditions?active_only=true"
              kind="code-name"
            />
          </WorkspaceTabsContent>
        </WorkspaceTabs>
      </div>
    </AdminPage>
  )
}
