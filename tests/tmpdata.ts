// Imported first by tests that write files: points the app's data folder at a fresh temp folder before src/config.ts loads.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.TD_DATA_DIR = mkdtempSync(join(tmpdir(), "td-test-"));
