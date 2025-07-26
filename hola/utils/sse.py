"""Server-Sent Events utilities for Hola.

This module provides utilities for implementing Server-Sent Events (SSE)
for real-time updates in the web interface.
"""

import asyncio
import json
from typing import AsyncGenerator, Dict, Any
from sse_starlette import EventSourceResponse

class SSEManager:
    """Manager for Server-Sent Events connections."""
    
    def __init__(self):
        self.connections: Dict[str, set] = {}
    
    def add_connection(self, topic: str, connection_id: str):
        """Add a connection to a topic."""
        if topic not in self.connections:
            self.connections[topic] = set()
        self.connections[topic].add(connection_id)
    
    def remove_connection(self, topic: str, connection_id: str):
        """Remove a connection from a topic."""
        if topic in self.connections:
            self.connections[topic].discard(connection_id)
            if not self.connections[topic]:
                del self.connections[topic]
    
    async def broadcast(self, topic: str, data: Dict[str, Any]):
        """Broadcast data to all connections on a topic."""
        if topic in self.connections:
            event_data = f"data: {json.dumps(data)}\n\n"
            # In a real implementation, you'd send to actual connections
            # This is a placeholder for the connection management
            pass

# Global SSE manager instance
sse_manager = SSEManager()

async def create_sse_response(
    generator_func: AsyncGenerator[str, None]
) -> EventSourceResponse:
    """Create a Server-Sent Events response.
    
    Args:
        generator_func: Async generator that yields SSE data
        
    Returns:
        EventSourceResponse for SSE
    """
    return EventSourceResponse(generator_func)

async def heartbeat_events() -> AsyncGenerator[str, None]:
    """Generate heartbeat events to keep SSE connections alive."""
    while True:
        await asyncio.sleep(30)  # Send heartbeat every 30 seconds
        yield f"data: {json.dumps({'type': 'heartbeat', 'timestamp': asyncio.get_event_loop().time()})}\n\n"
