# Gera o APK de release localmente (Gradle no Windows, sem EAS) e guarda em dist/.
#   npm run apk            build incremental
#   npm run apk -- -Clean  refaz a pasta android/ do zero (depois de mudar app.json ou plugins)
#   npm run apk -- -Install também instala no celular ligado por USB (adb)
param([switch]$Clean, [switch]$Install)
$ErrorActionPreference = "Stop"
$raiz = Split-Path $PSScriptRoot -Parent
Set-Location $raiz

$sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { "$env:LOCALAPPDATA\Android\Sdk" }
if (-not (Test-Path $sdk)) { throw "Android SDK não encontrado em $sdk (defina ANDROID_HOME)" }

# prebuild: gera android/ a partir do app.json quando falta ou quando pedem -Clean.
# Mudou o app.json (scheme, plugins, permissões)? Rode com -Clean: sem ele a android/ antiga fica, e a mudança
# não chega ao APK. (Rodar o prebuild sempre não serve: ele tenta apagar a pasta com o Gradle segurando arquivos.)
if ($Clean -or -not (Test-Path android)) {
    # O daemon do Gradle segura arquivos de android/ (EBUSY no --clean): para ele antes de apagar a pasta.
    # O --stop não derruba o daemon do Kotlin, que também segura arquivos: encerra os dois pelo nome da classe.
    if ($Clean -and (Test-Path android\gradlew.bat)) { Push-Location android; .\gradlew.bat --stop | Out-Null; Pop-Location }
    if ($Clean) {
        Get-CimInstance Win32_Process -Filter "Name='java.exe'" |
            Where-Object { $_.CommandLine -match 'GradleDaemon|kotlin-daemon|KotlinCompileDaemon' } |
            ForEach-Object { taskkill /T /F /PID $_.ProcessId 2>$null | Out-Null }
    }
    if ($Clean) { npx expo prebuild -p android --clean --no-install } else { npx expo prebuild -p android --no-install }
    if ($LASTEXITCODE) { throw "expo prebuild falhou" }
}
"sdk.dir=$($sdk -replace '\\', '/')" | Set-Content android\local.properties -Encoding ascii
# O prebuild recria o gradle.properties com 2 GB de heap, e o merge do dex estourava (OutOfMemoryError).
$props = "android\gradle.properties"
# WebP animado ligado: a prévia ao vivo do vídeo é um .webp animado, e sem isso o <Image> do Android não mostra nada.
(Get-Content $props) -replace '^org\.gradle\.jvmargs=.*', 'org.gradle.jvmargs=-Xmx4096m -XX:MaxMetaspaceSize=1024m' `
    -replace '^expo\.webp\.animated=.*', 'expo.webp.animated=true' | Set-Content $props -Encoding ascii

Push-Location android
try {
    .\gradlew.bat assembleRelease
    if ($LASTEXITCODE) { throw "Gradle falhou (código $LASTEXITCODE)" }
} finally { Pop-Location }

$versao = (Get-Content app.json -Raw | ConvertFrom-Json).expo.version
$nome = "forja-mobile-$versao-$(Get-Date -Format 'yyyyMMdd-HHmm').apk"
New-Item -ItemType Directory -Force dist | Out-Null
Copy-Item android\app\build\outputs\apk\release\app-release.apk "dist\$nome"
Write-Host "APK: $raiz\dist\$nome"

if ($Install) {
    & "$sdk\platform-tools\adb.exe" install -r "dist\$nome"
    if ($LASTEXITCODE) { throw "adb install falhou (celular conectado com depuração USB?)" }
}
