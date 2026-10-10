// The mssql package is CommonJS and builds its exports with Object.assign, so
// Node's ES module loader cannot see named exports. Load it through require
// to get the same object in Node, Vitest and the esbuild bundle.

import type * as Mssql from "mssql";
import { createRequire } from "node:module";

const requireCjs = createRequire(import.meta.url);

export const sql = requireCjs("mssql") as typeof Mssql;
export type { Mssql };
