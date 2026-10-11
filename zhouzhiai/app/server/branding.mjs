export const DEMO_PROJECT_DESCRIPTION = "同舟纵横流体技术";
export const PRODUCT_NAME = "舟知";

// Match only past built-in names. Deliberately chosen workspace names stay intact.
export function migrateWorkspaceBranding(workspace) {
  if (!/^(?:同舟|同州)\s*AI$/u.test(workspace.brand || "")) return false;
  workspace.brand = PRODUCT_NAME;
  return true;
}

// Only replace the obsolete built-in attribution, never user-entered descriptions
// or the contents/names of uploaded source documents.
export function migrateProjectBranding(projects) {
  let changed = false;
  for (const project of projects) {
    if (project.description === "鼎捷 AI 赋能 · 同舟纵横流体技术") {
      project.description = DEMO_PROJECT_DESCRIPTION;
      changed = true;
    }
  }
  return changed;
}
