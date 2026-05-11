#!/usr/bin/env node
import { executeWorkbenchBuiltInAdapterCommand } from "../execute.ts";

await executeWorkbenchBuiltInAdapterCommand({ adapterId: "pi" });
