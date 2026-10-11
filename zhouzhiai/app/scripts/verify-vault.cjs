// Run with the Electron binary: tests the real OS-backed safeStorage, no UI or real API key.
const {app,safeStorage}=require('electron');const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');const {providerVault}=require('../desktop/provider-vault.cjs');
app.setName('同州 AI');
app.whenReady().then(()=>{
 const dir=path.resolve('data/qa/vault-os');fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,'provider.enc');const fixture={provider:'mikoto',apiKey:'sk-fixture-os-encryption-test',model:'gpt-5.4'};
 providerVault(safeStorage,file,'write',fixture);
 assert.ok(!fs.readFileSync(file).includes(Buffer.from(fixture.apiKey)));
 assert.deepEqual(providerVault(safeStorage,file,'read'),fixture);
 const report={at:new Date().toISOString(),platform:process.platform,encryptionAvailable:safeStorage.isEncryptionAvailable(),ciphertextContainsPlaintext:false,roundTripPassed:true};
 fs.writeFileSync('data/qa/vault-os-v021.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));app.quit();
}).catch(e=>{console.error('System credential test failed:',e.message);app.exit(1)});
