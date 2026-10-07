export const DEMO_PROJECT_DESCRIPTION = "同舟纵横流体技术";

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
