import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  "packages/protocol",
  "packages/content",
  "packages/engine",
  "apps/server"
]);
