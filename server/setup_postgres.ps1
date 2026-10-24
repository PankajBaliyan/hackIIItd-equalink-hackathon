[CmdletBinding()]
param(
    [string]$PostgresUser = "postgres",
    [string]$HostName = "localhost",
    [int]$Port = 5432,
    [ValidatePattern('^[A-Za-z_][A-Za-z0-9_-]*$')]
    [string]$DatabaseName = "equalink"
)

$ErrorActionPreference = "Stop"
$psql = "C:\Program Files\PostgreSQL\18\bin\psql.exe"
$createdb = "C:\Program Files\PostgreSQL\18\bin\createdb.exe"

if (-not (Test-Path -LiteralPath $psql) -or -not (Test-Path -LiteralPath $createdb)) {
    throw "PostgreSQL 18 command-line tools were not found. Update the paths in this script if PostgreSQL is installed elsewhere."
}

$securePassword = Read-Host "Password for PostgreSQL user '$PostgresUser'" -AsSecureString
$credential = [System.Net.NetworkCredential]::new("", $securePassword)
$plainPassword = $credential.Password
$env:PGPASSWORD = $plainPassword

try {
    $exists = & $psql -w -h $HostName -p $Port -U $PostgresUser -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$DatabaseName'"
    if ($LASTEXITCODE -ne 0) { throw "Could not authenticate to PostgreSQL." }

    if ($exists.Trim() -ne "1") {
        & $createdb -w -h $HostName -p $Port -U $PostgresUser $DatabaseName
        if ($LASTEXITCODE -ne 0) { throw "Could not create database '$DatabaseName'." }
        Write-Host "Created PostgreSQL database '$DatabaseName'."
    }
    else {
        Write-Host "PostgreSQL database '$DatabaseName' already exists."
    }

    $encodedPassword = [Uri]::EscapeDataString($plainPassword)
    $databaseUrl = "postgresql+psycopg://${PostgresUser}:${encodedPassword}@${HostName}:${Port}/${DatabaseName}"
    $examplePath = Join-Path $PSScriptRoot ".env.example"
    $envPath = Join-Path $PSScriptRoot ".env"
    $contents = Get-Content -LiteralPath $examplePath -Raw
    $contents = $contents -replace '(?m)^DATABASE_URL=.*$', "DATABASE_URL=$databaseUrl"
    if ($contents -match '(?m)^STATE_SECRET=$') {
        $random = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
        $contents = $contents -replace '(?m)^STATE_SECRET=$', "STATE_SECRET=$random"
    }
    Set-Content -LiteralPath $envPath -Value $contents -Encoding utf8
    Write-Host "Wrote server/.env. Refresh Databases in pgAdmin to see '$DatabaseName'."
}
finally {
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
    $plainPassword = $null
    $credential = $null
}
