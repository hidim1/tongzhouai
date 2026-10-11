const fs = require("node:fs");
// Called only by the trusted main process in response to its own utility child.
function providerVault(safeStorage, file, action, input) {
  if (action === "read" && !fs.existsSync(file)) return null;
  if (!["read", "write"].includes(action)) throw new Error("无效凭据操作");
  if (!safeStorage.isEncryptionAvailable())
    throw new Error("系统凭据加密尚未就绪");
  if (action === "read")
    return JSON.parse(safeStorage.decryptString(fs.readFileSync(file)));
  fs.writeFileSync(
    file + ".tmp",
    safeStorage.encryptString(JSON.stringify(input)),
    { mode: 0o600 },
  );
  fs.renameSync(file + ".tmp", file);
  return null;
}
module.exports = { providerVault };
