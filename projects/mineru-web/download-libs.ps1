# Download frontend libraries for MinerU Web Client
# Run this script from the mineru-web directory

$libDir = "lib"
if (!(Test-Path $libDir)) {
    New-Item -ItemType Directory -Path $libDir | Out-Null
}

# pdf.js 4.0.379 (from GitHub releases)
Write-Host "Downloading pdf.js 4.0.379..."
$pdfjsVersion = "4.0.379"
Invoke-WebRequest -Uri "https://cdn.jsdelivr.net/npm/pdfjs-dist@$pdfjsVersion/build/pdf.min.mjs" -OutFile "$libDir/pdf.min.js"
Invoke-WebRequest -Uri "https://cdn.jsdelivr.net/npm/pdfjs-dist@$pdfjsVersion/build/pdf.worker.min.mjs" -OutFile "$libDir/pdf.worker.min.js"

# JSZip 3.10.1
Write-Host "Downloading JSZip 3.10.1..."
Invoke-WebRequest -Uri "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js" -OutFile "$libDir/jszip.min.js"

# marked 12.0.2
Write-Host "Downloading marked 12.0.2..."
Invoke-WebRequest -Uri "https://cdnjs.cloudflare.com/ajax/libs/marked/12.0.2/marked.min.js" -OutFile "$libDir/marked.min.js"

# KaTeX 0.16.11
Write-Host "Downloading KaTeX 0.16.11..."
Invoke-WebRequest -Uri "https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.11/katex.min.js" -OutFile "$libDir/katex.min.js"
Invoke-WebRequest -Uri "https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.11/katex.min.css" -OutFile "$libDir/katex.min.css"

Write-Host "Done! All libraries downloaded to $libDir/"
