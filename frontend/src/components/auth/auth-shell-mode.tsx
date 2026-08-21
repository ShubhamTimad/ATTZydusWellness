import * as React from "react"

/** When photo background is active, login form uses a full-height 20% rail. */
export const AuthShellModeContext = React.createContext<"card" | "rail">("card")
