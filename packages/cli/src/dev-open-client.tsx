import { createRoot } from "react-dom/client";
import { WorkbenchWorkspace } from "@workbench-ai/workbench-ui";

const root = document.getElementById("root");
if (!root) {
  throw new Error("Workbench local root element is missing.");
}

createRoot(root).render(
  <WorkbenchWorkspace
    apiBasePath="/api"
    routeBasePath="/"
    brandHref="/"
  />,
);
