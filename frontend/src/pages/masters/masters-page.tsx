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
import { useUrlTab } from "@/lib/use-url-tab"

const TAB_PANEL =
  "mt-0 flex min-h-0 flex-1 flex-col outline-none data-[state=inactive]:hidden"

const MASTER_TAB_KEYS = [
  "categories",
  "asset-classes",
  "functional",
  "actual",
  "cost-centers",
  "cc-custodians",
  "profit-centers",
  "tag-colors",
  "asset-conditions",
] as const

export function MastersPage() {
  const [plants, setPlants] = React.useState<PlantOption[]>([])
  const [tab, setTab] = useUrlTab(MASTER_TAB_KEYS, "categories")

  React.useEffect(() => {
    if (!canListOrgUnitsForAssignments()) return
    void getJson<PlantOption[]>("/admin/org-units?type=PLANT")
      .then(setPlants)
      .catch(() => toast.error("Could not load plants."))
  }, [])

  return (
    <AdminPage fullWidth dense viewportFill className="gap-[var(--app-grid-gap)]">
      <div className="flex min-h-0 flex-1 flex-col gap-[var(--app-grid-gap)]">
        <ListPageHeader className="shrink-0" title="Master" description="" />

        <WorkspaceTabs
          value={tab}
          onValueChange={setTab}
          className="flex min-h-0 flex-1 flex-col gap-[var(--app-grid-gap)]"
        >
          <WorkspaceTabsList className="shrink-0">
          <WorkspaceTabsTrigger value="categories">Categories</WorkspaceTabsTrigger>
          <WorkspaceTabsTrigger value="asset-classes">Asset Classes</WorkspaceTabsTrigger>
          <WorkspaceTabsTrigger value="functional">Functional Locations</WorkspaceTabsTrigger>
            <WorkspaceTabsTrigger value="actual">Actual Locations</WorkspaceTabsTrigger>
            <WorkspaceTabsTrigger value="cost-centers">Cost Centers</WorkspaceTabsTrigger>
            <WorkspaceTabsTrigger value="cc-custodians">Custodians</WorkspaceTabsTrigger>
            <WorkspaceTabsTrigger value="profit-centers">Profit Centers</WorkspaceTabsTrigger>
            <WorkspaceTabsTrigger value="tag-colors">Tag Colors</WorkspaceTabsTrigger>
            <WorkspaceTabsTrigger value="asset-conditions">Asset Conditions</WorkspaceTabsTrigger>
          </WorkspaceTabsList>

        <WorkspaceTabsContent value="categories" className={TAB_PANEL}>
          <MasterCrudPanel
            title="Asset Category"
            listUrl="/admin/asset-masters/categories?active_only=true"
            kind="category"
            entityLabel="Category"
          />
        </WorkspaceTabsContent>
        <WorkspaceTabsContent value="asset-classes" className={TAB_PANEL}>
          <MasterCrudPanel
            title="Asset Class"
            listUrl="/admin/asset-masters/asset-classes?active_only=true"
            kind="code-name"
            entityLabel="Asset Class"
          />
        </WorkspaceTabsContent>
        <WorkspaceTabsContent value="functional" className={TAB_PANEL}>
            <HierarchicalMasterPanel
              title="Functional Location"
              kind="functional-location"
              plants={plants}
            />
          </WorkspaceTabsContent>
          <WorkspaceTabsContent value="actual" className={TAB_PANEL}>
            <HierarchicalMasterPanel
              title="Actual Location"
              kind="actual-location"
              plants={plants}
            />
          </WorkspaceTabsContent>
          <WorkspaceTabsContent value="cost-centers" className={TAB_PANEL}>
            <HierarchicalMasterPanel title="Cost Center" kind="cost-center" plants={plants} />
          </WorkspaceTabsContent>
          <WorkspaceTabsContent value="cc-custodians" className={TAB_PANEL}>
            <CostCenterCustodiansPanel plants={plants} />
          </WorkspaceTabsContent>
          <WorkspaceTabsContent value="profit-centers" className={TAB_PANEL}>
            <HierarchicalMasterPanel title="Profit Center" kind="profit-center" plants={plants} />
          </WorkspaceTabsContent>
          <WorkspaceTabsContent value="tag-colors" className={TAB_PANEL}>
            <MasterCrudPanel
              title="Tag Color"
              listUrl="/admin/asset-masters/tag-colors?active_only=true"
              kind="tag-color"
              entityLabel="Tag color"
            />
          </WorkspaceTabsContent>
          <WorkspaceTabsContent value="asset-conditions" className={TAB_PANEL}>
            <MasterCrudPanel
              title="Asset condition"
              listUrl="/admin/asset-masters/asset-conditions?active_only=true"
              kind="code-name"
              entityLabel="Asset condition"
            />
          </WorkspaceTabsContent>
        </WorkspaceTabs>
      </div>
    </AdminPage>
  )
}
