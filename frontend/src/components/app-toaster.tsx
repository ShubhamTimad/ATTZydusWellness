import { Toaster } from "sonner"

export function AppToaster() {
  // Below sticky app header (h-14 / h-16) so toasts don't cover navbar actions.
  return (
    <Toaster
      richColors
      position="top-right"
      closeButton
      offset={{ top: "5rem", right: "1rem" }}
      mobileOffset={{ top: "5rem", right: "0.75rem" }}
    />
  )
}
