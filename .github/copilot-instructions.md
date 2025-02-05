# GitHub Copilot Instructions

## Overview

Python monorepo using Poetry workspaces with two main components:
1. **FastAPI Server** - Backend API with async/await, Pydantic models
2. **CLI Client** - Typer-based CLI with Rich output formatting

## Core Principles

- **Modern Python**: Type hints, PEP 8, async/await patterns
- **Testing**: Use fakes instead of mocks, organize by feature, ensure isolation
- **Architecture**: Dependency injection, separation of concerns, shared models via Poetry workspaces
- **Dependencies**: Context7 MCP Server (get-library-docs, resolve-library-id)
- **Communication**: REST API with OpenAPI spec, single API key authentication

## Component Guidelines

### FastAPI Server
- Pydantic models with extensive type hints
- Async operations, appropriate middleware
- Poetry scripts for command execution

### CLI Client  
- Typer commands with Rich formatting
- Always use `format_output` for user-facing output
- Use shared `ApiResponse` error structure
- Cross-platform compatibility

### API Client
- **Keep generic** - only HTTP helpers (`get`, `post`, `put`, `delete`)
- No command-specific methods
- Business logic belongs in command handlers

## Testing Standards

**Fakes Over Mocks**: NEVER use `unittest.mock.MagicMock`/`AsyncMock` for business dependencies
- Create fakes implementing same interface with in-memory behavior
- Store in `test_utils/fakes/` directories, name with "Fake" prefix
- Include state tracking (`has_message()`) and reset capabilities
- Only acceptable mocks: `patch` for environment control, `mock_open` for filesystem

**Test Organization**:
```
hola_{package}/
├── hola_{package}/
│   └── test_utils/
│       └── fakes/      # Package-specific fakes
└── tests/
    ├── {feature}/      # Feature-specific tests
    └── conftest.py     # Package fixtures
```

**Fixtures** (per package):
- `hola_shared`: Model factories, common responses
- `hola_server`: FastAPI TestClient, config overrides  
- `hola_cli`: Fake settings, output capture, server context

**Best Practices**:
- Isolated tests, unique names across modules
- Test positive/negative cases and edge conditions
- Meaningful assertions, use shared test utilities
- Import fakes first, then modules under test

**Running Tests**:
```bash
poetry run pytest                                    # All tests
poetry run pytest hola_server/tests                 # Package tests
poetry run pytest -k "test_deploy_app"             # Specific test
poetry run pytest-watch path/to/test.py            # Watch mode
```

## Logging & Output

**Architecture**: Layered approach - shared base (`hola_shared.logger`) → component-specific → application
- Use component-specific helpers, not direct shared layer calls
- Separate user-facing output from logs
- Include context (command name, request ID)
- Never log sensitive information

**CLI Logging**:
```python
from ..utils.logging import log_command_start, log_command_success, log_command_error

log_command_start(logger, "command.name", arg1="value1")
# ... command execution
log_command_success(logger, "command.name", result)  # or log_command_error
```

## CLI Command Implementation Pattern

**Structure**: Organize commands in packages with `__init__.py` exporting Typer instances
```python
# commands/app/__init__.py
import typer
from .commands import app_commands
app = typer.Typer(name="app", help="Manage applications")
app.add_typer(app_commands)
```

**Command Flow**:
```python
@app_commands.command("command-name")
def command_function(
    output: str = typer.Option("table", "--output", "-o", help="Output format"),
    server: Optional[str] = typer.Option(None, "--server", "-s", help="Target server"),
):
    """Command docstring."""
    try:
        log_command_start(logger, "command.name", output=output)
        server_context = get_current_server(server)
        service = SomeService(server_context)
        result = service.some_method()
        
        if output == "table":
            _print_table(result.data)
        else:
            formatted = format_output(result.data, output)
            console.print(formatted)
        
        log_command_success(logger, "command.name", result)
    except Exception as e:
        console.print(f"[bold red]Error:[/] {str(e)}")
        log_command_error(logger, "command.name", e)
        raise typer.Exit(code=1)
```

**Output**: Use Rich tables/panels, delegate business logic to services

## Architecture

**Server and Provider Architecture**:
1. **Provider** - CLI-only deployment environment classes (OrbStackProvider, DockerDesktopProvider)
2. **Server** - Running API server instance (ServerInstanceInfo model), provider-agnostic  
3. **ServerContext** - Client connection config (URL, API key) for CLI commands

**Project Structure**:
- **hola_server**: FastAPI backend with OpenAPI spec at `/public/docs/openapi.yaml`
- **hola_cli**: Typer CLI with Rich output, commands delegate to services
- **hola_shared**: Pydantic models, utilities shared across workspaces
- **hola_client_sdk**: Generated API client for server communication

**Communication**: REST API, single API key auth, shared Pydantic models via Poetry workspaces

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