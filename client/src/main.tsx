import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { AuthGate } from "./AuthGate";
import "./index.css";
import "./pdf-viewer.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthGate>{(signOut) => <App onSignOut={signOut} />}</AuthGate>
  </StrictMode>
);
