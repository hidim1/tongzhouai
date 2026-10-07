$ErrorActionPreference = 'Stop'
$url = 'http://127.0.0.1:14318'
$port = 14318
$sshProcess = $null

function Test-LocalPort {
    $client = New-Object System.Net.Sockets.TcpClient
    try { $client.Connect('127.0.0.1', $port); return $true }
    catch { return $false }
    finally { $client.Dispose() }
}

try {
    $ssh = Get-Command ssh.exe -ErrorAction Stop
    if (Test-LocalPort) { throw 'Local port 14318 is already in use. No existing process was stopped.' }
    $knownHosts = Join-Path $PSScriptRoot 'ssh-known-hosts'
    if (-not (Test-Path -LiteralPath $knownHosts)) { throw 'Keep ssh-known-hosts next to this script.' }
    Write-Host 'Tongzhou AI: enter the server SSH password. Input will not be echoed.'
    # Keep SSH attached to this console for its normal password prompt.
    $sshArgs = @('-F', 'NUL', '-N', '-o', 'UserKnownHostsFile=ssh-known-hosts',
        '-o', 'StrictHostKeyChecking=yes', '-o', 'HostKeyAlgorithms=ssh-ed25519',
        '-o', 'ExitOnForwardFailure=yes', '-o', 'ConnectTimeout=15',
        '-o', 'ServerAliveInterval=30', '-o', 'ServerAliveCountMax=3',
        '-L', '127.0.0.1:14318:127.0.0.1:4318', 'root@36.140.247.61')
    $sshProcess = Start-Process -FilePath $ssh.Source -ArgumentList $sshArgs -WorkingDirectory $PSScriptRoot -NoNewWindow -PassThru
    $deadline = (Get-Date).AddMinutes(3)
    $ready = $false
    while (-not $sshProcess.HasExited -and (Get-Date) -lt $deadline) {
        if (Test-LocalPort) {
            $response = $null
            $reader = $null
            try {
                # Ignore OS proxies and bound each readiness request.
                $http = [System.Net.HttpWebRequest]::Create("$url/api/bootstrap")
                $http.Proxy = $null
                $http.Timeout = 3000
                $http.ReadWriteTimeout = 3000
                $response = $http.GetResponse()
                $reader = New-Object System.IO.StreamReader($response.GetResponseStream())
                $data = $reader.ReadToEnd() | ConvertFrom-Json
                if ($null -ne $data.brand) { $ready = $true; break }
            } catch { }
            finally {
                if ($null -ne $reader) { $reader.Dispose() }
                if ($null -ne $response) { $response.Dispose() }
            }
        }
        Start-Sleep -Seconds 1
    }
    if (-not $ready) { throw 'Connection failed or timed out. Check the SSH output above.' }
    Write-Host "Connected: $url"
    Write-Host 'Keep this window open. Ctrl+C / closing it disconnects the tunnel.'
    Start-Process $url
    while (-not $sshProcess.HasExited) { Start-Sleep -Seconds 1 }
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
} finally {
    if ($null -ne $sshProcess -and -not $sshProcess.HasExited) {
        Stop-Process -Id $sshProcess.Id -ErrorAction SilentlyContinue
    }
}
