"""Command line interface for running the Hola server.

This module provides a command-line entry point for running the Hola server
using Uvicorn with appropriate configuration settings.
"""

import argparse
import uvicorn
from .config.settings import get_settings


def main():
    """Run the Hola server using Uvicorn."""
    parser = argparse.ArgumentParser(description='Run the Hola server')
    
    parser.add_argument(
        '--host',
        type=str,
        default='0.0.0.0',
        help='Host to bind the server to (default: 0.0.0.0)'
    )
    
    parser.add_argument(
        '--port',
        type=int,
        default=8000,
        help='Port to bind the server to (default: 8000)'
    )
    
    parser.add_argument(
        '--reload',
        action='store_true',
        help='Enable auto-reload for development'
    )
    
    args = parser.parse_args()
    
    settings = get_settings()
    
    print(f"Starting Hola server at http://{args.host}:{args.port}")
    print(f"API documentation available at http://{args.host}:{args.port}/docs")
    
    uvicorn.run(
        "hola.main:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
        log_level="info",
    )


if __name__ == "__main__":
    main()
