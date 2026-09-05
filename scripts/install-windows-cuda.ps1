# Install the Windows CUDA Python stack for VaakSetu.
# Run from an activated project environment or let the script discover .venv.
# Usage: .\scripts\install-windows-cuda.ps1 -CudaIndex cu121

param(
    [ValidateSet("cu121", "cu124", "cu126")]
    [string]$CudaIndex = "cu121"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Python = Join-Path $RootDir ".venv\Scripts\python.exe"
if (-not (Test-Path $Python)) {
    $Python = (Get-Command python -ErrorAction Stop).Source
}

Write-Host "VaakSetu Windows CUDA setup" -ForegroundColor Cyan
Write-Host "Using Python: $Python"
& $Python --version

Write-Host "[1/4] Installing base VaakSetu dependencies..." -ForegroundColor Yellow
& $Python -m pip install -r (Join-Path $RootDir "mini-services\requirements.txt")

Write-Host "[2/4] Replacing CPU PyTorch with CUDA PyTorch ($CudaIndex)..." -ForegroundColor Yellow
& $Python -m pip uninstall torch -y
& $Python -m pip install torch --index-url "https://download.pytorch.org/whl/$CudaIndex"

Write-Host "[3/4] Installing CUDA libraries used by faster-whisper..." -ForegroundColor Yellow
& $Python -m pip install nvidia-cublas-cu12 nvidia-cudnn-cu12

Write-Host "[4/4] Verifying CUDA..." -ForegroundColor Yellow
$cudaCheck = & $Python -c "import torch; print('cuda_available=' + str(torch.cuda.is_available()).lower()); print('cuda_version=' + str(torch.version.cuda)); print('device_count=' + str(torch.cuda.device_count())); print('device_name=' + (torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'none'))"
$cudaCheck | Write-Host
if ($cudaCheck -notmatch "cuda_available=true") {
    Write-Error "CUDA is not available to PyTorch. Check the NVIDIA driver, CUDA wheel compatibility, and nvidia-smi output."
}

Write-Host "CUDA setup completed. Start with VAAKSETU_DEVICE=auto or cuda." -ForegroundColor Green
