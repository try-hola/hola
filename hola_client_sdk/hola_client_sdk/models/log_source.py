from enum import Enum


class LogSource(str, Enum):
    APPLICATION = "application"
    BACKUP = "backup"
    DEPLOYMENT = "deployment"
    HEALTH_CHECK = "health_check"
    RESTORE = "restore"
    SYSTEM = "system"

    def __str__(self) -> str:
        return str(self.value)
