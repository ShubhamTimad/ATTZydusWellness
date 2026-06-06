export type ReportFilterOption = {
  value: string
  label: string
}

export type ReportFilter = {
  key: string
  label: string
  kind: string
  options: ReportFilterOption[]
}

export type ReportDefinition = {
  key: string
  title: string
  description: string
  filters: ReportFilter[]
}

export type ReportCatalog = {
  reports: ReportDefinition[]
  plants: { id: number; name: string; code: string }[]
}

export type ReportFormat = "xlsx" | "pdf"

export type ReportFilterValues = Record<string, string>
