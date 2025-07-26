"""Web interface routes for Hola.

This module provides the web interface routes that serve HTML pages and fragments
for the HTMX-based web interface.
"""

from fastapi import APIRouter, Request, Depends
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles
from pathlib import Path

# Template configuration
templates_dir = Path(__file__).parent / "templates"
templates = Jinja2Templates(directory=str(templates_dir))

# Static files configuration  
static_dir = Path(__file__).parent / "static"

router = APIRouter()

@router.get("/", response_class=HTMLResponse)
async def dashboard(request: Request):
    """Dashboard page - main overview."""
    # Mock data for now - replace with actual service calls
    stats = {
        "total_apps": 5,
        "running_apps": 3,
        "stopped_apps": 2,
        "issues": 0
    }
    
    if "HX-Request" in request.headers:
        return templates.TemplateResponse("fragments/dashboard_content.html", {
            "request": request, 
            "stats": stats
        })
    
    return templates.TemplateResponse("pages/dashboard.html", {
        "request": request,
        "stats": stats,
        "title": "Dashboard"
    })

@router.get("/apps", response_class=HTMLResponse)
async def apps_page(request: Request):
    """Applications page - list all applications."""
    if "HX-Request" in request.headers:
        return templates.TemplateResponse("fragments/apps_content.html", {
            "request": request
        })
    
    return templates.TemplateResponse("pages/apps.html", {
        "request": request,
        "title": "Applications"
    })

@router.get("/apps/deploy", response_class=HTMLResponse)
async def deploy_page(request: Request):
    """Deploy application page."""
    if "HX-Request" in request.headers:
        return templates.TemplateResponse("fragments/deploy_content.html", {
            "request": request
        })
    
    return templates.TemplateResponse("pages/deploy.html", {
        "request": request,
        "title": "Deploy Application"
    })

@router.get("/settings", response_class=HTMLResponse)
async def settings_page(request: Request):
    """Settings page - system configuration."""
    if "HX-Request" in request.headers:
        return templates.TemplateResponse("fragments/settings_content.html", {
            "request": request
        })
    
    return templates.TemplateResponse("pages/settings.html", {
        "request": request,
        "title": "Settings"
    })

# API endpoints that return fragments for HTMX
@router.get("/api/apps/list", response_class=HTMLResponse)
async def apps_list_fragment(request: Request):
    """Return apps list fragment for HTMX."""
    # Mock data - replace with actual service call
    apps = [
        {
            "name": "web-app",
            "status": "running",
            "description": "Main web application",
            "version": "1.0.0",
            "port": 8080
        },
        {
            "name": "api-service",
            "status": "running", 
            "description": "Backend API service",
            "version": "2.1.0",
            "port": 3000
        },
        {
            "name": "worker",
            "status": "stopped",
            "description": "Background worker process",
            "version": "1.5.0"
        }
    ]
    
    return templates.TemplateResponse("fragments/app_list.html", {
        "request": request,
        "apps": apps
    })

@router.get("/api/apps/recent", response_class=HTMLResponse)
async def recent_apps_fragment(request: Request):
    """Return recent apps fragment for dashboard."""
    # Mock data - replace with actual service call
    recent_apps = [
        {
            "name": "web-app",
            "status": "running",
            "description": "Main web application"
        },
        {
            "name": "api-service", 
            "status": "running",
            "description": "Backend API service"
        }
    ]
    
    return templates.TemplateResponse("fragments/app_list.html", {
        "request": request,
        "apps": recent_apps
    })

@router.get("/api/metrics/system", response_class=HTMLResponse)
async def system_metrics_fragment(request: Request):
    """Return system metrics fragment."""
    # Placeholder - implement with actual metrics
    return HTMLResponse("""
    <div class="space-y-4">
        <div class="flex justify-between">
            <span>CPU Usage</span>
            <span class="font-semibold">45%</span>
        </div>
        <progress class="progress progress-primary w-full" value="45" max="100"></progress>
        
        <div class="flex justify-between">
            <span>Memory Usage</span>
            <span class="font-semibold">62%</span>
        </div>
        <progress class="progress progress-info w-full" value="62" max="100"></progress>
        
        <div class="flex justify-between">
            <span>Disk Usage</span>
            <span class="font-semibold">28%</span>
        </div>
        <progress class="progress progress-success w-full" value="28" max="100"></progress>
    </div>
    """)

@router.get("/api/activity/recent", response_class=HTMLResponse)
async def recent_activity_fragment(request: Request):
    """Return recent activity fragment."""
    # Placeholder - implement with actual activity log
    return HTMLResponse("""
    <div class="space-y-3">
        <div class="flex items-center space-x-3">
            <div class="badge badge-success badge-sm"></div>
            <div>
                <p class="text-sm font-medium">web-app started</p>
                <p class="text-xs text-base-content/70">2 minutes ago</p>
            </div>
        </div>
        <div class="flex items-center space-x-3">
            <div class="badge badge-info badge-sm"></div>
            <div>
                <p class="text-sm font-medium">api-service deployed</p>
                <p class="text-xs text-base-content/70">15 minutes ago</p>
            </div>
        </div>
        <div class="flex items-center space-x-3">
            <div class="badge badge-warning badge-sm"></div>
            <div>
                <p class="text-sm font-medium">worker stopped</p>
                <p class="text-xs text-base-content/70">1 hour ago</p>
            </div>
        </div>
    </div>
    """)
