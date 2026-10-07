import fs from "node:fs";
import path from "node:path";

// These files are application-managed copies. Refresh bundled files on upgrade
// while retaining additional user files/skills. read/write also works with ASAR.
export function syncBundledSkills(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const src = path.join(source, entry.name);
    const dst = path.join(destination, entry.name);
    if (entry.isDirectory()) syncBundledSkills(src, dst);
    else {
      const bytes = fs.readFileSync(src);
      if (!fs.existsSync(dst) || !fs.readFileSync(dst).equals(bytes))
        fs.writeFileSync(dst, bytes);
    }
  }
}
