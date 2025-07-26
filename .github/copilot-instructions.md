# GitHub Copilot Instructions

## Overview

Python application deployment platform built as a single module with:
- **FastAPI Server** - Backend API with async/await, Pydantic models, and HTMX/DaisyUI web interface
- **Unified Architecture** - All functionality in one cohesive Python package

## Core Principles

- **Modern Python**: Type hints, PEP 8, async/await patterns
- **Testing**: Use fakes instead of mocks, organize by feature, ensure isolation  
- **Single Module**: Clean architecture within one Python package
- **Web-First**: HTMX and DaisyUI for dynamic, responsive web interface
- **API Access**: Complete REST API for automation and integration
- **Container Management**: Docker integration for application deployment

## Package Structure

### Main Application (`hola/`)
- **API Layer**: REST endpoints with smart content negotiation
- **Web Interface**: HTMX templates with DaisyUI styling
- **Services**: Business logic with dependency injection
- **Models**: Pydantic data models for consistency
- **Config**: Configuration management and settings
- **Utils**: Shared utilities and helpers

### Web Interface
- **HTMX Integration**: Dynamic behavior without complex JavaScript
- **DaisyUI Components**: Consistent, accessible design system
- **Progressive Enhancement**: Works without JavaScript, enhanced with it
- **Real-time Updates**: Server-Sent Events for live updates

## Testing Standards

**Fakes Over Mocks**: NEVER use `unittest.mock.MagicMock`/`AsyncMock` for business dependencies
- Create fakes implementing same interface with in-memory behavior
- Store in `test_utils/fakes/` directories, name with "Fake" prefix
- Include state tracking (`has_message()`) and reset capabilities
- Only acceptable mocks: `patch` for environment control, `mock_open` for filesystem

**Test Organization**:
```
hola/
├── api/               # API endpoints
├── web/               # Web interface (HTMX templates)
├── services/          # Business logic
├── models/            # Pydantic data models
├── config/            # Configuration management
├── utils/             # Utilities and helpers
└── test_utils/
    └── fakes/         # Test fakes and fixtures
tests/
├── api/               # API endpoint tests
├── web/               # Web interface tests
├── services/          # Service layer tests
└── conftest.py        # Test fixtures
```

**Fixtures**: Shared test fixtures and fakes for consistent testing

**Best Practices**:
- Isolated tests, unique names across modules
- Test positive/negative cases and edge conditions
- Meaningful assertions, use shared test utilities
- Import fakes first, then modules under test
- Test both API endpoints and web interface routes

**Running Tests**:
```bash
poetry run pytest                          # All tests
poetry run pytest tests/api/               # API tests
poetry run pytest tests/web/               # Web interface tests
poetry run pytest-watch tests/             # Watch mode
```

## Logging & Output

**Architecture**: Layered approach - shared base (`hola_shared.logger`) → server component → web/API layers
- Use server-specific helpers, not direct shared layer calls
- Separate user-facing output from logs
- Include context (request ID, user session)
- Never log sensitive information

**Server Logging**:
```python
from ..utils.logging import log_api_request, log_api_response, log_api_error

log_api_request(logger, "endpoint.name", request_id="abc123")
# ... endpoint execution
log_api_response(logger, "endpoint.name", request_id="abc123", response)  # or log_api_error
```

**Web Interface Logging**:
```python
from ..utils.logging import log_web_request, log_web_response, log_web_error

log_web_request(logger, "page.name", session_id="def456")
# ... page rendering
log_web_response(logger, "page.name", session_id="def456", response)
```

## Architecture

**Server Architecture**:
1. **Web Interface** - HTMX/DaisyUI interface for interactive management
2. **API Layer** - FastAPI REST endpoints for programmatic access
3. **Service Layer** - Business logic and application lifecycle management
4. **Storage Layer** - File-based persistence with Docker integration

**Project Structure**:
- **hola_server**: FastAPI backend with OpenAPI spec at `/public/docs/openapi.yaml`
- **hola_shared**: Pydantic models, utilities shared across workspaces

**Communication**: Web interface uses HTMX for dynamic updates, API provides REST endpoints with single API key auth

## Server Implementation

**HTMX-First Endpoint Pattern**:
```python
from fastapi import APIRouter, Depends, Request, Form
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.templating import Jinja2Templates

router = APIRouter()
templates = Jinja2Templates(directory="templates")

@router.post("/apps/deploy")
async def deploy_app(
    request: Request,
    app_name: str = Form(...),
    package_ref: str = Form(...)
):
    """Deploy application - returns HTML fragment for HTMX or JSON for API."""
    try:
        result = await deploy_application(app_name, package_ref)
        
        # HTMX request - return HTML fragment
        if "HX-Request" in request.headers:
            return templates.TemplateResponse("fragments/deploy_success.html", {
                "request": request, "app": result
            })
        
        # API request - return JSON
        return {"success": True, "data": result}
        
    except Exception as e:
        if "HX-Request" in request.headers:
            return templates.TemplateResponse("fragments/deploy_error.html", {
                "request": request, "error": str(e)
            }, status_code=400)
        
        return {"success": False, "error": str(e)}

@router.get("/apps")
async def apps_page(request: Request):
    """Apps page - full page for direct access, fragment for HTMX."""
    apps = await get_applications()
    
    if "HX-Request" in request.headers:
        return templates.TemplateResponse("fragments/app_list.html", {
            "request": request, "apps": apps
        })
    
    return templates.TemplateResponse("pages/apps.html", {
        "request": request, "apps": apps, "title": "Applications"
    })
```

**HTMX Integration Patterns**:
```html
<!-- Dynamic content loading -->
<div id="app-list" hx-get="/apps" hx-trigger="load" hx-target="#app-list">
  Loading applications...
</div>

<!-- Form with progress indicator -->
<form hx-post="/apps/deploy" hx-target="#result" hx-indicator="#spinner">
  <input name="app_name" required>
  <button type="submit">Deploy</button>
  <div id="spinner" class="loading htmx-indicator"></div>
</form>

<!-- Server-sent events for real-time updates -->
<div hx-sse="connect:/events/deployment/{{ deployment_id }}">
  <div hx-sse="swap:progress" hx-swap="innerHTML" id="progress"></div>
  <div hx-sse="swap:logs" hx-swap="beforeend" id="logs"></div>
</div>
```

**DaisyUI Component Usage**:
```html
<!-- Application status card -->
<div class="card bg-base-100 shadow-xl">
  <div class="card-body">
    <h2 class="card-title">
      App Name
      <div class="badge badge-success">Running</div>
    </h2>
    <div class="card-actions justify-end">
      <button class="btn btn-primary" 
              hx-get="/apps/myapp/manage" 
              hx-target="#main-content">
        Manage
      </button>
    </div>
  </div>
</div>
```

## Documentation & Conventions

**Code Documentation**: PEP 257 docstrings, explain _why_ not _what_, workspace-level docs for cross-cutting concerns

**Commit Messages**: [Conventional Commits](https://www.conventionalcommits.org/) with scope (`feat(cli):`, `fix(server):`, etc.), imperative mood

**Fake Implementation**:
```python
class FakeApiClient:
    def __init__(self):
        self.requests: List[RequestInfo] = []
        self.responses: Dict[str, Any] = {}
    
    def register_response(self, endpoint: str, response: Any) -> None:
        self.responses[endpoint] = response
    
    def get(self, endpoint: str) -> Any:
        self.requests.append(RequestInfo("GET", endpoint))
        return self.responses.get(endpoint, {})
    
    def reset(self) -> None:
        self.requests.clear()
        self.responses.clear()
```