"""Docker Desktop provider implementation.

This module implements the ServerProvider interface for Docker Desktop environments.
"""
import asyncio
import subprocess
import json
import logging
from typing import Dict, Any, Optional
from hola_shared.providers.base import ServerProvider

logger = logging.getLogger(__name__)

class DockerDesktopProvider:
    """Docker Desktop provider implementation.
    
    This provider enables Hola to create and manage servers
    running in Docker Desktop containers. It implements the ServerProvider
    interface to provide Docker-specific functionality for:
    
    1. Checking Docker Desktop availability
    2. Creating and managing Docker containers for servers
    3. Starting, stopping, and monitoring container status
    4. Exposing container ports to the host system
    5. Retrieving logs and container information
    
    The provider communicates with Docker through the Docker CLI, making
    it compatible with standard Docker Desktop installations.
    """
    
    type = "docker_desktop"
    display_name = "Docker Desktop"
    
    async def is_available(self) -> bool:
        """
        Check if Docker Desktop is installed and accessible.
        
        Attempts to run the 'docker version' command to verify Docker is installed
        and the Docker daemon is running.
        
        Returns:
            True if Docker Desktop is installed and running, False otherwise
        """
        try:
            logger.debug("Checking if Docker Desktop is available")
            process = await asyncio.create_subprocess_exec(
                "docker", "version", "--format", "{{.Server.Platform.Name}}",
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE
            )
            stdout, stderr = await process.communicate()
            
            if process.returncode == 0:
                logger.debug("Docker Desktop is available")
                return True
            else:
                logger.debug(f"Docker Desktop not available, return code: {process.returncode}")
                return False
        except Exception as e:
            logger.debug(f"Error checking Docker Desktop availability: {str(e)}")
            return False
    
    async def bootstrap(self, name: str, options: Dict[str, Any]) -> Dict[str, Any]:
        """
        Bootstrap a new Hola server on Docker Desktop.
        
        Creates a new container for running the Hola server using Docker Desktop.
        
        Args:
            name: Name for the server
            options: Configuration options for the server
                - image: Docker image to use (default: "python:3.10-slim")
                - port: Port to expose (default: 8000)
                - env: Environment variables to set
        
        Returns:
            Context information for the created server:
                - provider: Provider type
                - container_id: ID of the created container
                - status: Container status
        """
        logger.info("Bootstrapping Hola server on Docker Desktop")
        
        # Same implementation as OrbStack since both use the Docker CLI
        image = options.get("image", "python:3.10-slim")
        container_name = name
        port = options.get("port", 8000)
        env_vars = options.get("env", {})
        
        # Prepare environment variables
        env_args = []
        for key, value in env_vars.items():
            env_args.extend(["-e", f"{key}={value}"])
        
        # Create container
        try:
            create_cmd = [
                "docker", "create",
                "--name", container_name,
                "-p", f"{port}:8000",
                *env_args,
                image,
                "python", "-m", "uvicorn", "hola_server.main:app", "--host", "0.0.0.0"
            ]
            
            process = await asyncio.create_subprocess_exec(
                *create_cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE
            )
            stdout, stderr = await process.communicate()
            
            if process.returncode != 0:
                logger.error(f"Failed to create container: {stderr.decode()}")
                raise RuntimeError(f"Failed to create container: {stderr.decode()}")
            
            container_id = stdout.decode().strip()
            logger.info(f"Created container: {container_id}")
            
            # Return context
            return {
                "provider": self.type,
                "container_id": container_id,
                "name": container_name,
                "status": "created"
            }
            
        except Exception as e:
            logger.error(f"Error bootstrapping Docker Desktop container: {str(e)}")
            raise
    
    async def get_server_info(self, server_id: str, context: Dict[str, Any]) -> Dict[str, Any]:
        """
        Get information about a server.
        
        Retrieves status and details about a container running the Hola server.
        
        Args:
            server_id: ID of the server
            context: Provider-specific context for the server
                - container_id: ID of the container
                - name: Name of the container
        
        Returns:
            Server information including status
        """
        container_id = context.get("container_id")
        if not container_id:
            container_id = context.get("name", "hola-server")
        
        try:
            logger.debug(f"Getting info for container: {container_id}")
            process = await asyncio.create_subprocess_exec(
                "docker", "inspect", container_id,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE
            )
            stdout, stderr = await process.communicate()
            
            if process.returncode != 0:
                logger.error(f"Failed to inspect container: {stderr.decode()}")
                return {
                    "status": "unknown",
                    "error": stderr.decode(),
                    **context
                }
            
            container_info = json.loads(stdout.decode())
            if not container_info:
                return {
                    "status": "not_found",
                    **context
                }
            
            container_info = container_info[0]
            state = container_info.get("State", {})
            status = state.get("Status", "unknown").lower()
            
            return {
                "status": status,
                "started_at": state.get("StartedAt"),
                "ip_address": container_info.get("NetworkSettings", {}).get("IPAddress"),
                **context
            }
            
        except Exception as e:
            logger.error(f"Error getting server info: {str(e)}")
            return {
                "status": "error",
                "error": str(e),
                **context
            }
    
    async def start_server(self, server_id: str, context: Dict[str, Any]) -> Dict[str, Any]:
        """
        Start a server.
        
        Starts the Docker container running the Hola server.
        
        Args:
            server_id: ID of the server to start
            context: Provider-specific context for the server
                - container_id: ID of the container
                - name: Name of the container
                
        Returns:
            Updated server context
        """
        container_id = context.get("container_id")
        if not container_id:
            container_id = context.get("name", "hola-server")
        
        logger.info(f"Starting container: {container_id}")
        try:
            process = await asyncio.create_subprocess_exec(
                "docker", "start", container_id,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE
            )
            stdout, stderr = await process.communicate()
            
            if process.returncode != 0:
                logger.error(f"Failed to start container: {stderr.decode()}")
                return {
                    "status": "error",
                    "error": f"Failed to start container: {stderr.decode()}",
                    **context
                }
            
            logger.info(f"Container started: {container_id}")
            
            # Get updated container info
            return await self.get_server_info(server_id, context)
            
        except Exception as e:
            logger.error(f"Error starting server: {str(e)}")
            return {
                "status": "error",
                "error": str(e),
                **context
            }
    
    async def stop_server(self, server_id: str, context: Dict[str, Any]) -> Dict[str, Any]:
        """
        Stop a server.
        
        Stops the Docker container running the Hola server.
        
        Args:
            server_id: ID of the server to stop
            context: Provider-specific context for the server
                - container_id: ID of the container
                - name: Name of the container
                
        Returns:
            Updated server context
        """
        container_id = context.get("container_id")
        if not container_id:
            container_id = context.get("name", "hola-server")
        
        logger.info(f"Stopping container: {container_id}")
        try:
            process = await asyncio.create_subprocess_exec(
                "docker", "stop", container_id,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE
            )
            stdout, stderr = await process.communicate()
            
            if process.returncode != 0:
                logger.error(f"Failed to stop container: {stderr.decode()}")
                return {
                    "status": "error",
                    "error": f"Failed to stop container: {stderr.decode()}",
                    **context
                }
            
            logger.info(f"Container stopped: {container_id}")
            
            # Get updated container info
            return await self.get_server_info(server_id, context)
            
        except Exception as e:
            logger.error(f"Error stopping server: {str(e)}")
            return {
                "status": "error",
                "error": str(e),
                **context
            }
            
    async def delete_server(self, server_id: str, context: Dict[str, Any]) -> Dict[str, Any]:
        """
        Delete a server.
        
        Removes the Docker container for the Hola server.
        
        Args:
            server_id: ID of the server to delete
            context: Provider-specific context for the server
                - container_id: ID of the container
                - name: Name of the container
                
        Returns:
            Final server context
        """
        container_id = context.get("container_id")
        if not container_id:
            container_id = context.get("name", "hola-server")
        
        logger.info(f"Removing container: {container_id}")
        try:
            process = await asyncio.create_subprocess_exec(
                "docker", "rm", "-f", container_id,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE
            )
            stdout, stderr = await process.communicate()
            
            if process.returncode != 0:
                logger.error(f"Failed to remove container: {stderr.decode()}")
                return {
                    "status": "error",
                    "error": f"Failed to remove container: {stderr.decode()}",
                    **context
                }
            
            logger.info(f"Container removed: {container_id}")
            
            return {
                "status": "not_found",
                **context
            }
            
        except Exception as e:
            logger.error(f"Error deleting server: {str(e)}")
            return {
                "status": "error",
                "error": str(e),
                **context
            }
