# ============================================================================
# PIM1 Local Development Startup Script (PowerShell)
# ============================================================================
# Usage: .\scripts\start-local-dev.ps1
# This script sets up and runs the entire PIM1 stack locally
# ============================================================================

param(
    [switch]$SkipDocker,
    [switch]$SkipMigrations,
    [switch]$SkipBootstrap,
    [switch]$Interactive
)

# Color output
function Write-Success {
    Write-Host $args -ForegroundColor Green
}

function Write-Info {
    Write-Host $args -ForegroundColor Cyan
}

function Write-Warning {
    Write-Host $args -ForegroundColor Yellow
}

function Write-Error {
    Write-Host $args -ForegroundColor Red
}

# Check prerequisites
function Test-Prerequisites {
    Write-Info "🔍 Checking prerequisites..."
    
    # Check Node.js
    $nodeVersion = node --version 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Error "❌ Node.js not found. Please install Node.js 18+"
        exit 1
    }
    Write-Success "✓ Node.js: $nodeVersion"
    
    # Check npm
    $npmVersion = npm --version 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Error "❌ npm not found"
        exit 1
    }
    Write-Success "✓ npm: $npmVersion"
    
    # Check Docker (optional)
    if (-not $SkipDocker) {
        $dockerVersion = docker --version 2>$null
        if ($LASTEXITCODE -ne 0) {
            Write-Warning "⚠️  Docker not found. Skipping Docker services."
            $SkipDocker = $true
        } else {
            Write-Success "✓ Docker: $dockerVersion"
        }
    }
    
    Write-Info ""
}

# Setup environment
function Setup-Environment {
    Write-Info "🔧 Setting up environment..."
    
    # Copy .env if it doesn't exist
    if (-not (Test-Path ".env")) {
        if (Test-Path ".env.example") {
            Write-Info "Creating .env from .env.example..."
            Copy-Item ".env.example" ".env"
            Write-Success "✓ .env created"
            
            # Highlight sections to update
            Write-Warning "⚠️  Update these in .env:"
            Write-Warning "   - JWT_SECRET (min 32 chars)"
            Write-Warning "   - PIM_AUTH_PASSWORD (demo password)"
            Write-Warning "   - Connector credentials (Amazon, Flipkart, Meesho)"
        }
    } else {
        Write-Success "✓ .env already exists"
    }
    
    Write-Info ""
}

# Start Docker services
function Start-Docker {
    if ($SkipDocker) {
        Write-Warning "⏭️  Skipping Docker startup (--SkipDocker flag)"
        return
    }
    
    Write-Info "🐳 Starting Docker services..."
    
    # Check if containers are already running
    $runningContainers = docker ps --filter "name=pim1-" --format "{{.Names}}" 2>$null
    
    if ($runningContainers) {
        Write-Warning "⚠️  Some PIM1 containers already running:"
        Write-Warning $runningContainers
        Write-Info "Ensuring all services are up..."
        docker compose up -d 2>&1 | Out-Null
    } else {
        Write-Info "Starting fresh Docker stack..."
        docker compose up -d
    }
    
    # Check if startup successful
    if ($LASTEXITCODE -ne 0) {
        Write-Error "❌ Docker startup failed"
        exit 1
    }
    
    Write-Success "✓ Docker services started"
    Write-Info "   - PostgreSQL: localhost:5432"
    Write-Info "   - Redis: localhost:6379"
    Write-Info "   - RabbitMQ: localhost:5672 (UI: http://localhost:15672)"
    
    # Wait for services to be ready
    Write-Info "⏳ Waiting for services to be healthy..."
    $maxAttempts = 30
    $attempt = 0
    
    while ($attempt -lt $maxAttempts) {
        try {
            $pgReady = docker exec pim1-postgres pg_isready -U postgres -d pim1 2>$null | Select-String "accepting"
            $redisReady = docker exec pim1-redis redis-cli ping 2>$null | Select-String "PONG"
            
            if ($pgReady -and $redisReady) {
                Write-Success "✓ All services are healthy"
                break
            }
        } catch {
            # Silently continue
        }
        
        $attempt++
        Start-Sleep -Seconds 1
    }
    
    if ($attempt -eq $maxAttempts) {
        Write-Warning "⚠️  Services may not be fully ready, continuing anyway..."
    }
    
    Write-Info ""
}

# Install dependencies
function Install-Dependencies {
    Write-Info "📦 Installing dependencies..."
    
    if (Test-Path "node_modules" -PathType Container) {
        Write-Info "node_modules already exists, skipping install"
        Write-Info "Run 'npm install' manually if you need a fresh install"
    } else {
        npm install
        if ($LASTEXITCODE -ne 0) {
            Write-Error "❌ npm install failed"
            exit 1
        }
        Write-Success "✓ Dependencies installed"
    }
    
    Write-Info ""
}

# Generate Prisma client
function Generate-Prisma {
    Write-Info "🔄 Generating Prisma client..."
    
    npm run prisma:generate
    if ($LASTEXITCODE -ne 0) {
        Write-Error "❌ Prisma generation failed"
        exit 1
    }
    Write-Success "✓ Prisma client generated"
    
    Write-Info ""
}

# Run migrations
function Run-Migrations {
    if ($SkipMigrations) {
        Write-Warning "⏭️  Skipping migrations (--SkipMigrations flag)"
        return
    }
    
    Write-Info "🗄️  Running database migrations..."
    
    npm run prisma:migrate:deploy
    if ($LASTEXITCODE -ne 0) {
        Write-Error "❌ Migration failed"
        exit 1
    }
    Write-Success "✓ Migrations completed"
    
    Write-Info ""
}

# Bootstrap admin (optional)
function Bootstrap-Admin {
    if ($SkipBootstrap) {
        Write-Warning "⏭️  Skipping admin bootstrap (--SkipBootstrap flag)"
        return
    }
    
    Write-Info "👤 Bootstrapping admin user..."
    
    npm run auth:bootstrap-admin
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "⚠️  Admin bootstrap had issues, but continuing..."
    } else {
        Write-Success "✓ Admin bootstrapped"
    }
    
    Write-Info ""
}

# Start development servers
function Start-DevServers {
    Write-Info "🚀 Starting development servers..."
    Write-Success "✓ Configuration complete!"
    Write-Info ""
    Write-Info "Starting servers in the background..."
    Write-Info ""
    
    # Create a helper script to run both servers
    $serverScript = @'
$ErrorActionPreference = "Continue"
Write-Host "📡 Starting API server (port 4000)..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList {
    cd $pwd
    npm run dev:api
} -NoNewWindow

Start-Sleep -Seconds 2

Write-Host "📡 Starting Web server (port 3000)..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList {
    cd $pwd
    npm run dev:web
} -NoNewWindow

Write-Host ""
Write-Host "✅ Both servers started!" -ForegroundColor Green
Write-Host ""
Write-Host "Access the application:" -ForegroundColor Green
Write-Host "  🌐 Web UI:  http://localhost:3000" -ForegroundColor Cyan
Write-Host "  📡 API:     http://localhost:4000/api/v1" -ForegroundColor Cyan
Write-Host "  📚 Docs:    http://localhost:4000/api/docs" -ForegroundColor Cyan
Write-Host ""
Write-Host "Default Credentials:" -ForegroundColor Green
Write-Host "  Workspace: default" -ForegroundColor Cyan
Write-Host "  Email:     admin@pim1.local" -ForegroundColor Cyan
Write-Host "  Password:  vexa-pim-demo-password (or from .env PIM_AUTH_PASSWORD)" -ForegroundColor Cyan
Write-Host ""
Write-Host "RabbitMQ UI: http://localhost:15672 (guest/guest)" -ForegroundColor Yellow
Write-Host ""
Write-Host "Press Ctrl+C to stop servers" -ForegroundColor Yellow
Write-Host ""

# Keep the parent script running
while ($true) { Start-Sleep -Seconds 1 }
'@
    
    # Execute the server startup script
    Invoke-Expression $serverScript
}

# Main execution
function Main {
    Clear-Host
    Write-Host ""
    Write-Success "╔════════════════════════════════════════════════════════════════╗"
    Write-Success "║           PIM1 LOCAL DEVELOPMENT STARTUP SCRIPT                 ║"
    Write-Success "╚════════════════════════════════════════════════════════════════╝"
    Write-Host ""
    
    # Navigate to repo root
    $scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
    $repoRoot = Split-Path -Parent $scriptPath
    Set-Location $repoRoot
    
    Write-Info "📍 Working directory: $(Get-Location)"
    Write-Info ""
    
    # Run all steps
    Test-Prerequisites
    Setup-Environment
    
    if (-not $SkipDocker) {
        Start-Docker
    }
    
    Install-Dependencies
    Generate-Prisma
    Run-Migrations
    Bootstrap-Admin
    
    # Start servers
    Start-DevServers
}

# Run main
Main
