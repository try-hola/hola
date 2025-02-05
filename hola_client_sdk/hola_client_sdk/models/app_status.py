from enum import Enum


class AppStatus(str, Enum):
    CREATED = "created"
    DEPLOYING = "deploying"
    ERROR = "error"
    RUNNING = "running"
    STARTING = "starting"
    STOPPED = "stopped"
    STOPPING = "stopping"
    UNKNOWN = "unknown"
    UPGRADING = "upgrading"

    def __str__(self) -> str:
        return str(self.value)
