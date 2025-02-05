from enum import Enum


class BackupStatus(str, Enum):
    COMPLETED = "completed"
    CREATING = "creating"
    DELETED = "deleted"
    FAILED = "failed"

    def __str__(self) -> str:
        return str(self.value)
