"""Deployment events for Server-Sent Events.

This module provides real-time deployment progress updates via SSE.
"""

import asyncio
import json
from typing import AsyncGenerator
from sse_starlette import EventSourceResponse

async def deployment_events(deployment_id: str) -> AsyncGenerator[str, None]:
    """Generate deployment progress events.
    
    Args:
        deployment_id: Unique deployment identifier
        
    Yields:
        Server-sent events with deployment progress
    """
    # Mock deployment progress - replace with actual deployment monitoring
    steps = [
        {"step": "Downloading package", "progress": 10},
        {"step": "Extracting files", "progress": 30},
        {"step": "Building containers", "progress": 60},
        {"step": "Starting services", "progress": 80},
        {"step": "Deployment complete", "progress": 100}
    ]
    
    for i, step in enumerate(steps):
        await asyncio.sleep(2)  # Simulate work
        
        event_data = {
            "deployment_id": deployment_id,
            "step": step["step"],
            "progress": step["progress"],
            "status": "success" if step["progress"] == 100 else "in_progress"
        }
        
        yield f"data: {json.dumps(event_data)}\n\n"
        
        if step["progress"] == 100:
            break

def create_deployment_sse(deployment_id: str) -> EventSourceResponse:
    """Create Server-Sent Events response for deployment progress.
    
    Args:
        deployment_id: Unique deployment identifier
        
    Returns:
        EventSourceResponse for SSE
    """
    return EventSourceResponse(deployment_events(deployment_id))
